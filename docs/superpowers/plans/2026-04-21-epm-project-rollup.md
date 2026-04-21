# EPM Project Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## For reviewers (Codex, humans) — read before diving in

- **Repo:** `jira-execution-planner` (Flask + React/esbuild dashboard that queries Jira Cloud + Atlassian Home/Townsquare GraphQL).
- **Branch:** `feature/epm-project-view-impl`. Plan is written against HEAD `1bd92f1` (author: Juce-me, 2026-04-21). Merge base is `main`.
- **Prior plans on this branch (for context only — do not re-implement):**
  - `docs/superpowers/plans/2026-04-20-epm-project-view.md` — introduced EPM view, Home client, config, and endpoints.
  - `docs/superpowers/plans/2026-04-21-epm-settings-scope-and-linkage.md` — moved EPM scope into settings, added `customName` + free-text Jira label/epic fields.
  - `docs/superpowers/plans/2026-04-21-epm-goal-picker.md` — replaced manual scope entry with root-goal + sub-goal pickers; fixed the Home container ARI (`ari:cloud:townsquare::site/<cloudId>`); added `/api/epm/scope`, `/api/epm/goals`.
- **What user feedback triggered THIS plan (reviewers should assume this is the authoritative description of the problem):**
  1. `POST /api/epm/projects/preview` takes **~78s**, `GET /api/epm/projects` takes **~45s** for a goal with ~20 Home projects. Cause: sequential per-project GraphQL fan-out, paginated `projects_byId.updates` with `first: 10` even though only the single latest update is used.
  2. The user-visible "projects dropdown is empty" symptom was actually "projects list has not loaded yet after 45s." Separate from the perf issue, this exposed a model mismatch: the user wants the dashboard to surface Jira Initiatives/Epics/Stories grouped by **Project**, where a Project is defined by a single Jira label (e.g., `rnd_project_bsw`), not by re-fetching Home metadata.
  3. The prior "enrich Home project with optional `jiraLabel` + `jiraEpicKey`" model is being replaced. Epic-key field is dropped. Label becomes the primary key of a Project's rollup.
  4. User explicitly rejected a global `rnd_project_*` wildcard fallback. Jira does not support label wildcards in JQL anyway; this plan enumerates labels via the Jira label autocomplete endpoint and uses exact-match `labels = "<label>"`.
  5. User explicitly confirmed: (a) Initiatives are a rollup level above Epics (2-hop parent-in traversal); (b) label autocomplete filters by prefix with a "show all" escape hatch; (c) the prefix lives as a setting (default `"rnd_project_"`, editable in the EPM canvas), documented in AGENTS.md §10.
- **Out-of-scope in this plan** (listed at the bottom) — reviewers should confirm nothing in the task list creeps past those boundaries.

### Review checklist for Codex

Walk the plan in this order and fail fast on any "no":

1. Does each Task list its Files section and a failing-test step before the implementation step? (TDD invariant, AGENTS.md §4.)
2. Are the JQL builders wildcard-free, with label-value escaping? (N1, N3.)
3. Does the rollup endpoint validate `tab=active` requires a numeric `sprint` (400 `sprint_required` / `sprint_not_numeric`), and does it cache keyed by `(projectId, tab, sprint, label, base_jql)`? (N3a, Task 5 Step 3 case e.)
4. Does Q1/Q2/Q3 run **without** a Sprint clause, with sprint applied post-union to leaf issuetypes only (so labeled Initiatives/Epics always seed the tree)? (N3a, Task 5 Step 3 case f.)
5. Does the hierarchy response carry three mutually-exclusive buckets — `initiatives`, `rootEpics`, `orphanStories` — that can encode a labeled Epic with no labeled Initiative parent and a labeled Story with no labeled parent? (N3, Task 5 Step 3 case d, Task 7 Step 2.)
6. Are the three rollup response states distinct and non-overlapping: `metadataOnly` (no label saved) vs `emptyRollup` (label saved but zero matches) vs normal render? (N3, N10, Task 5 Step 3 cases a–c, Task 7 Step 1 guards e–f.)
7. Does Task 3b wire custom Projects into `/api/epm/projects`, `/api/epm/projects/preview`, and `find_epm_project_or_404` so a saved custom Project appears in the selector and its UUID resolves on `/rollup`? (N4a, Task 3b.)
7a. Do custom Projects carry `tabBucket: 'all'` AND does `filterEpmProjectsForTab` treat `'all'` as visible on every tab, so custom Projects do not disappear on Backlog/Archived? (N4b, Task 3b guard e, Task 7 Step 1 guard g, Task 7 Step 2 filter change.)
8. Does the config migration accept v1 without data loss and emit v2, and do custom Projects get a UUID `id` generated once and preserved across renames? (N4, N5, Task 3 Step 1 case c.)
9. Does the `customName → name` rename propagate to Task 6 source guards? (Task 6 Step 1 guard d must say `name`, not `customName`.)
10. Does Task 4 extend the existing `/api/jira/labels` with a `prefix=` param (respecting the endpoint's actual `startAt/maxResults/isLast` pagination), not invent a new `/api/epm/labels` route? (N8, Task 4.)
11. Does the UI call `/api/jira/labels` with an explicit `limit=200` (the server default is 50; client-side typeahead filtering against 50 silently drops valid matches)? (N8, Task 6 guard b.)
12. Do JS source-guard tests run via `node --test tests/<file>.js` in every verification step, never via `python -m unittest`? (Tasks 2, 6, 7, 9.)
13. Do perf fixes (Task 1) cap fan-out, memoize cloud-id, and use `first: 1` for updates? (N6.)
14. Is every new endpoint covered by both a Python unittest and (where a frontend surface is added) a JS source guard? (Tasks 3–7.)
15. Are all tests using synthetic placeholders (no `CRITE-*`, no real tenant labels)? (N12, AGENTS.md §Security.)
16. Does the plan touch `TASKS_CACHE` or `LABELS_CACHE` on config save? It must not. (N9.)
17. Is `rnd_project_` referenced only as a default value for `epm.labelPrefix`, never hardcoded in JQL or in the rollup endpoint? (N2, N11, Task 8.)

If any answer is "no," fail the review with a pointer to the specific Task/Note.

## Plan summary

**Goal:** Replace the current "Jira Home projects enriched with optional label/epic" model with a first-class **Project** rollup driven by a single Jira label per Project. A Project's rollup surfaces every Initiative/Epic/Story/Task carrying its label, plus descendants whose ancestor carries the label, deduplicated by issue key and rendered as a 3-level hierarchy (Initiative → Epic → Story).

**Architecture:** Projects become their own config entity. Each Project has `name` (defaults to a Home Goal name, user-editable) and `label` (a single Jira label, autocomplete-suggested from the configurable global prefix, default `rnd_project_`). Projects can be seeded from the selected Home sub-goal's child goals OR added manually (name + label only). Rollup is computed backend-side via three JQL calls: labeled issues (Q1), children of labeled Initiatives/Epics (Q2), grandchildren via Epic children of labeled Initiatives (Q3). No global fallback — a Project with no label stays in the `metadata-only` state. In parallel, the settings/preview performance regression (45s–78s wall time) is fixed by capping project-update fan-out and parallelizing per-project detail fetches.

**Tech Stack:** Python (Flask backend), React (JSX frontend), Python `unittest`, Node test runner, esbuild

**Jira pagination contract reminder (AGENTS.md §Architecture):** `nextPageToken` / `isLast`. Do not introduce `startAt` / `total`.

---

## Pre-Execution Notes

### N1. Single label per Project. No wildcard. No fallback.

- Each Project has exactly one label (a string like `rnd_project_bsw`).
- No `labels ~ "prefix*"` — Jira does not support wildcards in JQL label operators.
- If a Project has no label, render the existing `metadata-only` state (OPEN SETTINGS CTA). Do NOT silently match every `rnd_project_*` label. The user explicitly rejected global fallback.

### N2. Label prefix is a setting, not a constant.

Persist `epm.labelPrefix` in `dashboard-config.json` with default `"rnd_project_"`. The EPM settings canvas exposes this as a field. Backend rollup code reads the saved prefix for label autocomplete filtering only. **The rollup query itself uses the exact chosen label, not the prefix.** Document the default in AGENTS.md §10 "Project context" so future agents do not hardcode the literal.

### N3. Rollup query — 2 hops, 3 queries, dedup by key.

The hierarchy is Initiative → Epic → Story/Task. For a single labeled Project:

- **Q1:** `labels = "<label>"` → set `S1` (all issue types with the label applied directly).
- **Q2:** `parent in (<keys from S1 whose issuetype ∈ {Initiative, Epic}>)` → set `S2` (direct children of labeled Initiatives/Epics).
- **Q3:** `parent in (<keys from S2 whose issuetype = Epic>)` → set `S3` (stories under Epic children of labeled Initiatives — the 2nd hop).

Result = `S1 ∪ S2 ∪ S3`, deduped by `issue.key`. Every issue falls into exactly one of three mutually-exclusive buckets in the response payload:

```json
{
  "initiatives": {
    "<initiativeKey>": {
      "issue": { ... },
      "epics": {
        "<epicKey>": { "issue": { ... }, "stories": [ { ... }, ... ] }
      },
      "looseStories": [ { ... }, ... ]
    }
  },
  "rootEpics": {
    "<epicKey>": { "issue": { ... }, "stories": [ { ... }, ... ] }
  },
  "orphanStories": [ { ... }, ... ]
}
```

Placement rules (evaluate in order for each deduped issue):

1. Initiative → `initiatives[key]`.
2. Epic with a labeled Initiative parent present in this result → `initiatives[initiativeKey].epics[epicKey]`.
3. Epic without a labeled Initiative ancestor in this result (i.e., the Epic itself is labeled) → `rootEpics[epicKey]`.
4. Story/Task/Sub-task with a parent Epic present in this result → `.stories` under the owning Epic (either under an Initiative or in `rootEpics`).
5. Story/Task with a parent Initiative in this result but no Epic in-between → `initiatives[initiativeKey].looseStories`.
6. Anything else (no labeled ancestor appears in the result) → `orphanStories`.

This shape handles the three real cases: labeled-Initiative hierarchies, labeled-Epic-only hierarchies (no Initiative), and directly-labeled Stories without any labeled parent. No issue is dropped; no issue is represented twice.

**Three distinct response states — do not conflate.** All three share the same top-level keys so callers can render a single renderer branch; the `metadataOnly` and `emptyRollup` flags drive the UI state. The three hierarchy buckets (`initiatives`, `rootEpics`, `orphanStories`) are always present in the payload; empty for the non-render states.

- Project has no `label` saved → `{ metadataOnly: true, emptyRollup: false, initiatives: {}, rootEpics: {}, orphanStories: [] }`. UI shows OPEN SETTINGS CTA. Do not run any query.
- Project has a `label` saved and Q1 returns zero matches → `{ metadataOnly: false, emptyRollup: true, initiatives: {}, rootEpics: {}, orphanStories: [] }`. UI shows "No issues match this label in the current scope." Do not run Q2/Q3.
- Otherwise → `{ metadataOnly: false, emptyRollup: false, initiatives: {...}, rootEpics: {...}, orphanStories: [...] }` populated per the placement rules above.

### N3a. Tab/sprint contract — validation preserved, filter applied differently.

The legacy `/api/epm/projects/<id>/issues` endpoint enforces: `tab=active` requires a numeric `sprint` param (400 `sprint_required` / `sprint_not_numeric` otherwise), `tab=backlog` / `tab=archived` ignore sprint. Cache key varies by `(projectId, tab, sprint, base_jql, linkage)`. See `jira_server.py:6464-6505` and `tests/test_epm_scope_resolution.py:44-58`. The rollup endpoint keeps the same **validation contract**, but applies the sprint filter differently because the rollup flow depends on structural queries that cannot tolerate sprint filtering without losing parents.

**Validation (unchanged from existing contract):**

- Accept `?tab=<active|backlog|archived>&sprint=<digits>`. Default `tab=active`.
- If `tab=active` and `sprint` is missing → 400 `{ error: 'sprint_required' }`. Non-numeric sprint → 400 `{ error: 'sprint_not_numeric' }`.
- Cache key: `(projectId, tab, sprint, label, base_jql)`. Cache TTL matches `EPM_ISSUES_CACHE_TTL_SECONDS`.

**Why queries cannot be sprint-filtered:** If Q1 filters by Sprint, a labeled Initiative or Epic without a Sprint field is dropped, so its key never seeds Q2/Q3 and its descendants are undiscoverable. The claim "descendants still render as orphans" is impossible under a filtered-seed flow.

**Query execution — always unfiltered by Sprint:**

- Q1, Q2, Q3 always run with `base_jql` AND the label / parent clauses only. No `Sprint = N` clause is injected.
- The existing `base_jql` from `build_base_jql()` still applies (tenant-level project scoping, etc.).

**Sprint filter — applied post-union, to leaf issuetypes only:**

- After union-and-dedup, if `tab=active` and `sprint=N` is present, drop any issue whose `issuetype.name` is in the leaf set `{'Story', 'Task', 'Sub-task', 'Subtask', 'Bug'}` AND whose sprint-field values do NOT contain sprint id `N`. Initiatives and Epics are never filtered — the tree spine is label-determined, not sprint-determined.
- For `tab=backlog` and `tab=archived`, no additional filtering is applied. The existing `/api/epm/projects/<id>/issues` endpoint does NOT apply any status/tab issue-level filter beyond the active-tab sprint requirement (see `jira_server.py:6468-6492`). Do not invent new backlog/archived filters — this plan does not specify or test any, and `build_epm_fields_list` is a field-selection helper, not a filter.
- The sprint-field name to check is the same one the ENG flow uses. Verify by reading `shape_epm_issue_payload` output fields before implementing; do NOT hardcode a custom field id.
- Ensure the Jira fields list passed to `fetch_issues_by_jql` includes the sprint field for all three queries (otherwise the post-filter has no data to look at).

**Tree rebuild after filtering:** because the post-filter removes only leaves, the three-bucket hierarchy (N3) is still valid — just with fewer stories under each Epic/Initiative, and possibly empty `stories`/`looseStories` arrays. The renderer must tolerate empty leaf arrays without collapsing the parent row.

### N4. Config shape changes.

Before (post goal-picker plan):

```json
"epm": {
  "version": 1,
  "scope": { "rootGoalKey": "...", "subGoalKey": "..." },
  "projects": {
    "<homeProjectId>": {
      "homeProjectId": "...",
      "customName": "...",
      "jiraLabel": "...",
      "jiraEpicKey": "..."
    }
  }
}
```

After:

```json
"epm": {
  "version": 2,
  "labelPrefix": "rnd_project_",
  "scope": { "rootGoalKey": "...", "subGoalKey": "..." },
  "projects": {
    "<projectId>": {
      "id": "<projectId>",
      "name": "<display name, defaults to Home Goal name>",
      "label": "rnd_project_bsw",
      "homeProjectId": "<optional — null for custom projects>"
    }
  }
}
```

`jiraEpicKey` is dropped entirely. `jiraLabel` becomes `label` and carries the exact full label string. `homeProjectId` is optional (custom Projects have no Home linkage). `version` bumps to 2 to trigger migration.

### N4a. Custom Projects must flow through the same API surface as Home-linked Projects.

Both project selectors (`/api/epm/projects`, `/api/epm/projects/preview`) and the rollup lookup (`/api/epm/projects/<id>/rollup`) must treat custom Projects as first-class entries alongside Home-derived ones. Concretely:

- `build_epm_projects_payload(epm_config)` at `jira_server.py:1449-1457` must return `Home-derived projects ∪ custom Projects from config.projects[].filter(row.homeProjectId == null)`. Custom Projects render with `matchState: 'jep-fallback'` when `label` is set, `'metadata-only'` otherwise (per N10).
- `find_epm_project_or_404(project_id)` at `jira_server.py:1460-1475` must resolve both Home `homeProjectId` strings and custom-Project UUIDs. **Branch explicitly on row shape, do not short-circuit Home-linked rows to the bare config entry** — the config stores only `{id, name, label, homeProjectId}` for Home-linked Projects, so serving them straight from config would lose Home-derived fields (`stateValue`, `stateLabel`, `tabBucket`, `latestUpdateDate`, `latestUpdateSnippet`, `homeUrl`). Correct flow:
  1. Look up `config.projects[project_id]`. If not found, fall through to the existing Home-scan fallback (covers cache drift).
  2. If the row has `homeProjectId == null` (custom Project) → return `build_custom_project_payload(row)` — no GraphQL call.
  3. If the row has `homeProjectId` set (Home-linked Project) → resolve the Home metadata via the existing Home fetch path (`fetch_epm_home_projects` + cache hit first), then merge the config's `name`/`label` overrides onto the Home-shaped record via `build_epm_project_payload(home_record, row)`. The Home fetch path is the source of truth for lifecycle fields; config is the source of truth for user-typed `name` and `label`.
- The rollup endpoint's `<id>` segment accepts either shape. No URL scheme change; the UUID format is opaque to the router.
- A custom Project's `build_epm_project_payload` synthesizes the Home-shaped fields (`homeProjectId: null`, `homeUrl: ''`, `stateValue: ''`, `stateLabel: ''`, `tabBucket: 'all'`, `latestUpdateDate: ''`, `latestUpdateSnippet: ''`, `name: row.name`, `displayName: row.name`). No GraphQL calls.

### N4b. Tab filter must accept the `all` bucket for custom Projects.

Home-derived projects have a lifecycle bucket (`active` / `backlog` / `archived`) derived from their Atlassian Home state. Custom Projects have no Home state — they are config-only containers. Hardcoding `tabBucket: 'active'` would make them visible only on the Active tab and disappear from Backlog/Archived, which is wrong: the user created the container to slice Jira work, not to track a lifecycle.

Resolution — custom Projects get `tabBucket: 'all'`, and the filter treats `'all'` as a wildcard:

- Update `filterEpmProjectsForTab` at `frontend/src/epm/epmProjectUtils.mjs:9-14` so it matches when `project.tabBucket === 'all'` OR `project.tabBucket === normalizedTab`. Single-line change.
- Regression test lives in a new file `tests/test_epm_project_utils.test.js` — a pure-function Node test (`node:test` + `node --test`) that imports `filterEpmProjectsForTab` directly from `frontend/src/epm/epmProjectUtils.mjs`. Assert: a project with `tabBucket: 'all'` appears on all three tabs (`active`, `backlog`, `archived`); a project with each of the three lifecycle buckets appears only on the matching tab; a project with missing/empty `tabBucket` appears on no tab (regression guard against silent omission). Do NOT duplicate this coverage in `tests/test_epm_view_source_guards.js` — that file stays source-grep style.
- Do NOT silently omit `tabBucket` on custom Projects — missing/empty string would also hide them (the existing filter uses `|| ''` fallback, which never matches a real tab). The explicit `'all'` sentinel is the contract.

### N5. Migration.

`normalize_epm_config` must accept both v1 and v2 payloads. On v1:
- Copy `jiraLabel` → `label`.
- Drop `jiraEpicKey`.
- Set `labelPrefix` to `"rnd_project_"` if absent.
- Use `homeProjectId` as the new `id` for Home-linked rows.
- Use `customName` as `name`; if empty, leave empty (will be backfilled from Home Goal name at render time).

**Stable IDs for custom Projects.** Custom Projects (no `homeProjectId`) get an id generated **once at creation time** via `uuid.uuid4().hex` (or equivalent). The id is persisted on the row and **never recomputed** — in particular, not from `name`. Renaming a custom Project must not change its id. Add a regression test: create a custom Project, save, rename, save again, assert `id` is unchanged and that `epm.projects[id]` still resolves.

No destructive changes: persist v2 on next save, but keep reading v1 safely.

### N6. Perf invariants (parallel to the feature work).

- `fetch_latest_project_update` must use `first: 1` and stop after one page. The endpoint paginates `first: 10` today and reads only `ordered[0]` — pure waste (`epm_home.py:232-244, 399-408`).
- Parallelize the per-project detail + latest-update fan-out in `fetch_projects_for_goal` using `concurrent.futures.ThreadPoolExecutor(max_workers=8)`. Preserve list order by zipping results back.
- Memoize the detected cloud ID at module scope in `epm_home.fetch_home_site_cloud_id` keyed on `JIRA_URL` — first call fetches, subsequent calls return the cache.
- Document hard fan-out cap: max 200 projects per rollup; stop paginating `goals_byId.projects` past that.

### N7. ENG panel leakage.

The "Loading product tasks…" banner currently renders in EPM mode (see Image 4 of the 2026-04-21 session — `tasks-with-team-name` fetches fire on EPM load). Gate the tasks fetch effect on `selectedView === 'eng'` as part of this plan. Catalog the exact `useEffect` at `frontend/src/dashboard.jsx:~8596-8603` area and surrounding task-fetching effects.

### N8. Label autocomplete — extend existing `/api/jira/labels`.

Do NOT add a new `/api/epm/labels` endpoint. The existing `/api/jira/labels` at `jira_server.py:6220-6255` already:

- Paginates `GET /rest/api/3/label` using the endpoint's native `startAt`/`maxResults` + `isLast` termination (the Jira label endpoint uses this shape — **not** `nextPageToken`/`isLast`, which is the contract for `/rest/api/3/search/jql`; AGENTS.md §10 refers to the search endpoint).
- Caches results in module-level `LABELS_CACHE`.
- Supports a `query=<substr>` param that filters case-insensitive substring matches.

Extend it with one additional query param: `prefix=<str>`. When present, filter `labels = [l for l in labels if l.lower().startswith(prefix.lower())]` (applied after the substring `query` filter, if both are passed). Keep the existing `limit` cap.

Frontend behavior:

- Default autocomplete call: `GET /api/jira/labels?prefix=<epm.labelPrefix>&limit=200` (e.g. `prefix=rnd_project_&limit=200`).
- "Show all labels" toggle: `GET /api/jira/labels?limit=200` (no `prefix`).
- Always pass `limit=200`. The server default is 50 (`jira_server.py:6204`), which truncates the returned slice and — combined with client-side substring filtering — silently drops valid prefixed labels from the typeahead. The endpoint caps at 200; do not request more.
- Typeahead substring match is done client-side against the returned list (labels per project are small; 200-cap is plenty for the `rnd_project_*` convention).

No new cache. No new endpoint. Three-line change on the backend (`prefix=` filter applied after the cache fill).

### N9. Cache isolation unchanged.

`POST /api/epm/config` still clears only `EPM_PROJECTS_CACHE`, `EPM_ISSUES_CACHE`, plus the new `EPM_ROLLUP_CACHE`. Never touch `TASKS_CACHE` or `LABELS_CACHE` (labels are tenant-scoped, not config-scoped).

### N10. Match-state enum — three mutually-exclusive states.

Keep `'home-linked'`, `'jep-fallback'`, `'metadata-only'`. Semantics:

- `'home-linked'` — Project has a saved `label` AND a `homeProjectId` linking to a Home Goal.
- `'jep-fallback'` — Project has a saved `label` but no `homeProjectId` (custom Project).
- `'metadata-only'` — Project has **no** saved `label`, regardless of `homeProjectId`.

`metadataOnly` (the rollup response flag, N3) and `'metadata-only'` (the project match-state enum) mean the same thing: **no label saved**. A Project with a valid label but zero current Jira matches is NOT `metadata-only` — it is `home-linked` or `jep-fallback` with `emptyRollup: true`.

Document in `docs/features/epm-view.md`.

### N11. Never falls back silently.

There is no default-to-prefix match. A Project with empty `label` renders metadata-only. The `rnd_project_` prefix is used **only** as the autocomplete filter in the settings canvas.

### N12. Security: no real tenant keys in tests.

All new tests use synthetic placeholders (`ACME-1`, `rnd_project_example`, `cloud-test-id`). Follow AGENTS.md §Security strictly. The codex-fix commit already scrubbed existing tests — do not reintroduce real keys.

---

## File Structure

**Modify:**

- `epm_home.py` — module-level `cloudId` memoization, `first: 1` project-updates fetch, ThreadPoolExecutor fan-out, documented fan-out cap
- `epm_scope.py` — new `build_rollup_jqls(label)` helper that emits the three JQL strings; keep `build_epm_scope_clause` for the legacy issues endpoint during migration only
- `jira_server.py` — v1→v2 migration in `normalize_epm_config`, `prefix=` query param on existing `/api/jira/labels`, new `/api/epm/projects/<id>/rollup` endpoint (preserves tab/sprint contract), new `EPM_ROLLUP_CACHE`
- `frontend/src/dashboard.jsx` — new EPM settings canvas (prefix field, label autocomplete with show-all toggle, name defaulting, add-custom-Project button, remove epic field), rollup-view renderer (Initiative → Epic → Story hierarchy with dedup), ENG panel gating fix
- `frontend/src/epm/epmProjectUtils.mjs` — label normalization + rollup tree builder
- `tests/test_epm_config_api.py` — v1→v2 migration, labelPrefix persistence, custom Project rows, label field validation
- `tests/test_epm_home_api.py` — cloud-id memoization, `first: 1` updates, ThreadPoolExecutor order preservation
- `tests/test_epm_projects_api.py` — custom-Project surfacing in `/api/epm/projects` and `/api/epm/projects/preview`, `find_epm_project_or_404` branching by `homeProjectId` (custom UUID vs Home id), `tabBucket: 'all'` payload field. Rollup endpoint contract lives in `tests/test_epm_rollup_api.py` (Create list below)
- `tests/test_epm_scope_resolution.py` — rollup JQL builder output
- `tests/test_epm_settings_source_guards.js` — prefix field, autocomplete, show-all toggle, add-custom-Project markers
- `tests/test_epm_view_source_guards.js` — rollup view hierarchy markers, ENG leak regression guard
- `AGENTS.md` — §10 Project context note: `epm.labelPrefix` default is `"rnd_project_"`, configurable in settings, never hardcoded
- `README.md` — EPM configuration section
- `docs/features/epm-view.md` — Project rollup model, hierarchy rendering, label conventions
- `frontend/dist/dashboard.js` + `.js.map` + `.css` — committed build artifacts

**Create:**

- `tests/test_epm_rollup_api.py` — `/api/epm/projects/<id>/rollup` endpoint (S1/S2/S3 union, dedup, tab/sprint contract, three response states)
- `tests/test_epm_project_utils.test.js` — pure-function Node test for `filterEpmProjectsForTab` with the `tabBucket: 'all'` wildcard behavior (N4b)
- `docs/features/epm-rollup.md` — operator-facing doc for the new Project model (optional — can be folded into `epm-view.md` if concise)

**Note on labels tests:** extend the existing Jira labels endpoint test coverage (wherever `/api/jira/labels` is currently tested, or add a small case to `tests/test_epm_config_api.py`) to cover the new `prefix=` param. Do not create a new `test_epm_labels_api.py`.

---

## Task 1: Perf pass — land the small, safe wins first

**Why first:** The 45s/78s timings make every subsequent manual verification painful. Fix perf before the feature so iteration is viable.

**Files:**
- Modify: `tests/test_epm_home_api.py`
- Modify: `epm_home.py`

- [ ] **Step 1: Write failing tests for cloud-id memoization and single-page updates.**

Assert (a) `fetch_home_site_cloud_id` calls `urlopen` exactly once across two invocations when `JIRA_URL` is unchanged, (b) `fetch_latest_project_update` issues exactly one GraphQL call with `first: 1`, (c) `fetch_projects_for_goal` preserves input ordering when fan-out is parallelized.

- [ ] **Step 2: Implement memoization + single-page updates + ThreadPoolExecutor fan-out.**

Module-level cache `_CLOUD_ID_CACHE: dict[str, str]` keyed by `JIRA_URL`. Replace `execute_paginated` in `fetch_latest_project_update` with a single `execute(QUERY_PROJECT_UPDATES, {"projectId": project_id, "first": 1})` and read `edges[0].node`. In `fetch_projects_for_goal`, wrap the per-project detail + update fetch in a helper function and submit via `ThreadPoolExecutor(max_workers=8)`, collecting results in input order.

- [ ] **Step 3: Run tests, verify success, run full suite.**

```bash
.venv/bin/python -m unittest tests.test_epm_home_api
.venv/bin/python -m unittest discover -s tests
```

---

## Task 2: ENG panel leak in EPM mode

**Files:**
- Modify: `tests/test_epm_view_source_guards.js`
- Modify: `frontend/src/dashboard.jsx`

- [ ] **Step 1: Add a source guard that fails if any `fetchTasks`/`productTasks` effect is unconditionally reachable when `selectedView === 'epm'`.**

Grep for known ENG-fetch effect triggers (`tasks-with-team-name`, `setProductTasksLoading`, etc.) and assert each is guarded by `if (selectedView !== 'eng') return;` or equivalent.

- [ ] **Step 2: Gate the ENG task-loading effects on `selectedView === 'eng'`.**

Audit `frontend/src/dashboard.jsx` for all `useEffect` blocks that call ENG-mode endpoints. Add early returns for `selectedView !== 'eng'`.

- [ ] **Step 3: Rebuild bundle, run the source guard, and visually verify EPM mode shows no "Loading product tasks…" banner.**

```bash
npm run build
node --test tests/test_epm_view_source_guards.js
```

Open `http://127.0.0.1:5050`, switch to EPM, confirm the banner is gone and no `tasks-with-team-name` calls in the Network tab.

---

## Task 3: Config v1→v2 migration

**Files:**
- Modify: `tests/test_epm_config_api.py`
- Modify: `jira_server.py`

- [ ] **Step 1: Write failing tests for `normalize_epm_config` accepting v1 and emitting v2.**

Cover: (a) v1 config with `jiraLabel` + `jiraEpicKey` + `customName: "Foo"` → v2 with `label`, no `jiraEpicKey`, `labelPrefix: "rnd_project_"`, `name: "Foo"`; (b) v2 config round-trips unchanged; (c) custom Projects (no `homeProjectId`) persist with a UUID-generated `id` that does **not** change when `name` is edited — assert via: create, save, rename, save, re-read, `id` is the same string; (d) missing `label` → Project row persists with `label: ""` and the rollup endpoint reports `metadataOnly: true` for it; (e) GET `/api/epm/config` returns v2 shape; (f) v1 input with empty `customName` loads as v2 with empty `name` (render-time fallback to Home Goal name is the UI's job, not the normalizer's).

- [ ] **Step 2: Implement migration in `normalize_epm_config`.**

Detect v1 by absence of `labelPrefix`/`version==2`. For v1 input, map as described in N5. For Home-linked rows, set `id = homeProjectId`. For custom Projects, generate `id = uuid.uuid4().hex` on first persist and carry it forward on every subsequent normalize — never recompute from `name`. Keep `normalize_epm_project_row` tolerant of both shapes during the deprecation window.

- [ ] **Step 3: Run tests, verify success.**

```bash
.venv/bin/python -m unittest tests.test_epm_config_api
```

---

## Task 3b: Surface custom Projects through the project APIs

Without this task, custom Projects are savable but invisible — `/api/epm/projects` and `/api/epm/projects/preview` iterate Home projects only, and `find_epm_project_or_404` keys strictly on `homeProjectId`. See N4a.

**Files:**
- Modify: `tests/test_epm_projects_api.py`
- Modify: `jira_server.py`

- [ ] **Step 1: Write failing tests.**

Cover: (a) saved config with 2 Home-linked Projects + 2 custom Projects → `GET /api/epm/projects` returns all 4, Home-derived first, custom Projects following, each with the correct `matchState`. (b) `POST /api/epm/projects/preview` with the same draft config returns the same union. (c) `find_epm_project_or_404('<custom-uuid>')` returns the custom row; `find_epm_project_or_404('<home-id>')` returns the Home row; `find_epm_project_or_404('unknown')` → 404. (d) A custom Project with empty `label` renders `matchState: 'metadata-only'`; non-empty → `'jep-fallback'`. (e) Every custom Project has `tabBucket: 'all'` in the payload (per N4b).

- [ ] **Step 2: Implement.**

Extend `build_epm_projects_payload` to append custom-Project rows (rows where `homeProjectId == null`) after the Home loop. Build each via a new helper `build_custom_project_payload(row)` that synthesizes the Home-shaped fields listed in N4a (including `tabBucket: 'all'` per N4b) — no GraphQL call. Rewrite `find_epm_project_or_404` per the N4a branching rules: (i) config lookup by id; (ii) if custom, synthesize via `build_custom_project_payload`; (iii) if Home-linked, resolve the Home metadata through the existing fetch path and merge config overrides via `build_epm_project_payload`; (iv) if not in config at all, fall through to the existing Home-scan fallback. Add a focused test that the Home-linked branch still surfaces `stateValue`/`stateLabel`/`tabBucket`/`latestUpdateDate` sourced from the Home path, not from config.

- [ ] **Step 3: Run tests, verify success.**

```bash
.venv/bin/python -m unittest tests.test_epm_projects_api
```

---

## Task 4: Extend `/api/jira/labels` with `prefix=` filter

Do not add a new endpoint. Extend the existing route at `jira_server.py:6220-6255`.

**Files:**
- Modify: `tests/test_epm_config_api.py` (or the existing labels test file if one exists)
- Modify: `jira_server.py`

- [ ] **Step 1: Write failing tests for the new `prefix=` param on `/api/jira/labels`.**

Cover: (a) `GET /api/jira/labels?prefix=rnd_project_` returns only labels that case-insensitively start with `rnd_project_`; (b) `prefix=` and `query=` combine (prefix first, then substring); (c) no `prefix` param → existing behavior unchanged (regression guard); (d) existing `limit` cap still applies after filtering. Do **not** change pagination — the Jira label endpoint returns `{startAt, maxResults, total, isLast, values[]}` and the existing loop at lines 6226-6244 is already correct.

- [ ] **Step 2: Implement the `prefix` filter.**

Inside the existing handler, after loading `labels` from cache or from Jira, apply `labels = [l for l in labels if l.lower().startswith(prefix.lower())]` when `prefix` is present. Roughly 3 lines. Keep `LABELS_CACHE` untouched (it stores the unfiltered list; filtering is per-request).

- [ ] **Step 3: Run tests, verify success.**

```bash
.venv/bin/python -m unittest tests.test_epm_config_api
```

---

## Task 5: Rollup JQL builder + endpoint

**Files:**
- Modify: `tests/test_epm_scope_resolution.py`
- Create: `tests/test_epm_rollup_api.py`
- Modify: `epm_scope.py`
- Modify: `jira_server.py`

- [ ] **Step 1: Write failing tests for `build_rollup_jqls(label)` in `epm_scope.py`.**

Cover: (a) empty label returns `None`; (b) non-empty label returns `(s1_jql, s2_predicate, s3_predicate)` where `s1_jql = 'labels = "<escaped>"'` and the predicates are callables that take a list of keys and return `'parent in (...)'`; (c) label values containing `"` or `\` are properly escaped; (d) empty key lists passed to predicates return `None` (no query).

- [ ] **Step 2: Implement the builder.**

Keep the existing label-escaping helper from the codex fix. Build Q1 from the label. Q2 and Q3 are deferred-query builders that accept keys derived from Q1/Q2 respectively. No wildcards.

- [ ] **Step 3: Write failing tests for `/api/epm/projects/<id>/rollup`.**

Cover these cases explicitly — all must pass before implementation is considered done:

- (a) Project with `label: ""` → 200 `{metadataOnly: true, emptyRollup: false, initiatives: {}, rootEpics: {}, orphanStories: []}`. Q1/Q2/Q3 must NOT run (assert via mock).
- (b) Project with `label` set, Q1 returns zero → 200 `{metadataOnly: false, emptyRollup: true, initiatives: {}, rootEpics: {}, orphanStories: []}`. Q2/Q3 must NOT run.
- (c) Project with `label` set, Q1 returns mixed issuetypes → executes Q2 over Initiative+Epic keys, then Q3 over Epic keys emitted by Q2. Issues are deduped by `issue.key` across S1 ∪ S2 ∪ S3; a story appearing in both S1 (direct label) and S3 (child of labeled Epic) renders once.
- (d) Hierarchy three-bucket placement (matches N3 rules). Build a fixture that exercises each rule:
  - labeled Initiative with labeled Epic child with unlabeled Story grandchild → `initiatives[I].epics[E].stories[S]`.
  - labeled Initiative with unlabeled Story direct child (no Epic between) → `initiatives[I].looseStories`.
  - labeled Epic with NO labeled Initiative parent → `rootEpics[E]` with its stories nested.
  - labeled Story with no labeled parent in the result → `orphanStories`.
  - Every input issue appears in exactly one bucket; no issue is dropped.
- (e) **Tab/sprint validation preserved** — `GET /api/epm/projects/<id>/rollup?tab=active` without `sprint` → 400 `{error: 'sprint_required'}`; with non-numeric sprint → 400 `{error: 'sprint_not_numeric'}`. `tab=backlog` and `tab=archived` accept no sprint. Replicate `tests/test_epm_scope_resolution.py:44-58` style.
- (f) **Sprint filter is post-union, leaves only.** With `tab=active&sprint=N`, assert: (f1) no captured JQL passed to `fetch_issues_by_jql` contains `Sprint = `; (f2) the response keeps all Initiatives and Epics from the unfiltered union; (f3) Stories / Tasks / Sub-tasks not in sprint N are removed from their containing bucket; (f4) Parents with emptied story arrays still render (the parent row is kept even if its `stories: []`).
- (g) Response cached keyed by `(projectId, tab, sprint, label, base_jql)`. Cache invalidated on `POST /api/epm/config`.
- (h) Custom Project id — given a custom Project with UUID id saved in config, `GET /api/epm/projects/<uuid>/rollup` resolves the Project from config (no Home fetch path), executes the same Q1/Q2/Q3, and returns the same shape.

- [ ] **Step 4: Implement the endpoint.**

Add `EPM_ROLLUP_CACHE` and `EPM_ROLLUP_CACHE_TTL_SECONDS = 300`. Factor `validate_epm_tab_sprint(tab, sprint) -> (error_json, status) | None` for reuse between `/issues` and `/rollup` endpoints. Resolve the Project via the updated `find_epm_project_or_404` (Home id OR custom UUID, per N4a). Build `base_jql = build_base_jql()`. Build the three JQLs via `build_rollup_jqls(label)` — **no Sprint clause injected**. Ensure the field list passed to `fetch_issues_by_jql` includes the sprint field (check `build_epm_fields_list` and extend if needed). Run Q1; if empty → early return `emptyRollup`. Extract initiative/epic keys from Q1 → run Q2. Extract epic keys from Q2 → run Q3. Union issues, dedup by key, apply sprint post-filter (if `tab=active && sprint`) to leaf issuetypes only, build the three-bucket hierarchy per N3, return.

- [ ] **Step 5: Run all rollup tests + full suite, verify success.**

---

## Task 6: EPM settings canvas rewrite

**Files:**
- Modify: `tests/test_epm_settings_source_guards.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/epm/epmProjectUtils.mjs`

- [ ] **Step 1: Write failing source guards for the new settings canvas.**

Guards: (a) `labelPrefix` field renders with persisted value (default `"rnd_project_"`); (b) label input is an autocomplete, calls `/api/jira/labels?prefix=<labelPrefix>&limit=200` on focus (both params required; the default server limit of 50 is too small for client-side typeahead filtering and would silently drop valid matches); (c) "Show all labels" toggle re-queries `/api/jira/labels?limit=200` without `prefix`; (d) `name` field (NOT `customName`) defaults to `homeProject.name` via placeholder / render-time fallback when empty; (e) "Add custom Project" button renders a row with `name` + `label` only (no `homeProjectId`), and the row's `id` comes from the server after first save (client sends placeholder, server assigns UUID); (f) the epic-key input is removed from the DOM (regression guard: no `data-field="jiraEpicKey"` and no "Jira Epic" label text in EPM settings).

- [ ] **Step 2: Implement the settings canvas.**

Prefix field at top of EPM settings, bound to `epm.labelPrefix`. For each Project row: editable `name` input (placeholder = Home Goal name; empty value is valid and renders as the Home Goal name at display time), label autocomplete (typeahead against `/api/jira/labels?prefix=<savedPrefix>&limit=200`; always pass `limit=200` so client-side filtering has a large-enough pool), show-all toggle (re-queries `/api/jira/labels?limit=200` without `prefix`), remove button. "Add custom Project" button appends a new row with `homeProjectId: null` and a client-side placeholder id (the server rewrites to UUID on save; keep the client's draft id stable within the session for React keys). Remove the epic-key field and its hydration. Add `hydrateEpmProjectDraft` helper in `epmProjectUtils.mjs` that returns `{...row, displayName: row.name || homeProject?.name || ''}` for each row — the normalizer persists `name` exactly as typed, never the Home fallback.

- [ ] **Step 3: Rebuild, run guards, verify visually.**

JS source-guard tests use the Node test runner (`tests/test_epm_settings_source_guards.js` top-line is `require('node:test')`). Run with `node --test` — they are NOT `unittest` tests.

```bash
npm run build
node --test tests/test_epm_settings_source_guards.js
```

---

## Task 7: EPM rollup view rendering

**Files:**
- Modify: `tests/test_epm_view_source_guards.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/epm/epmProjectUtils.mjs`

- [ ] **Step 1: Write failing source guards for the rollup view.**

Guards: (a) EPM board calls `/api/epm/projects/<id>/rollup` with the current `tab` and `sprint` URL params (preserving the legacy gating at `dashboard.jsx:907-921` — do not fetch when `tab=active && !selectedSprint`); (b) renderer groups issues by Initiative → Epic → Story hierarchy when `metadataOnly: false && emptyRollup: false`; (c) dedup by issue key (same story appearing in S1 and S3 renders once); (d) orphan stories (no labeled parent) render under the Project directly; (e) `metadataOnly: true` response shows OPEN SETTINGS CTA; (f) `emptyRollup: true` response shows a **different** empty-state message ("No issues match this label in the current scope") — this is the check Codex flagged, confirm the two states render distinct UI; (g) `filterEpmProjectsForTab` (at `frontend/src/epm/epmProjectUtils.mjs:9-14`) treats `tabBucket: 'all'` as visible on every tab, preserving exact-match behavior for lifecycle buckets (`'active'`/`'backlog'`/`'archived'`). Add a pure-function unit test that constructs projects with each bucket value and asserts visibility across all three tabs.

- [ ] **Step 2: Implement the rollup renderer.**

Add `buildRollupTree(payload)` in `epmProjectUtils.mjs` that consumes `{metadataOnly, emptyRollup, initiatives, rootEpics, orphanStories}` and returns either `{kind: 'metadataOnly'}`, `{kind: 'emptyRollup'}`, or `{kind: 'tree', initiatives: [...], rootEpics: [...], orphanStories: [...]}`. The renderer in `dashboard.jsx` branches on `kind`. Use existing sticky header classes (see AGENTS.md §"Sticky UI Layering" — do not introduce new z-index). Reuse existing issue-row components from ENG mode where possible.

Also update `filterEpmProjectsForTab` at `frontend/src/epm/epmProjectUtils.mjs:9-14` to treat `tabBucket: 'all'` as a wildcard: `project.tabBucket === 'all' || normalizedBucket === normalizedTab`. Preserve the existing `|| ''` fallback so malformed payloads still hide safely (neither `''` nor any other value besides the four canonical ones matches any tab).

- [ ] **Step 3: Rebuild, run the source guard, and visually verify against a real tenant.**

```bash
npm run build
node --test tests/test_epm_view_source_guards.js
```

Switch to EPM, pick a Project with a saved label, confirm hierarchy renders across all three buckets (labeled Initiative with labeled Epic child, labeled Epic without Initiative parent → rootEpics, labeled Story without labeled parent → orphanStories), confirm dedup, confirm metadata-only path for Projects with no label, confirm emptyRollup path for a Project whose label currently matches zero issues.

---

## Task 8: Documentation + AGENTS.md

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/features/epm-view.md`

- [ ] **Step 1: AGENTS.md §10 Project context note.**

```markdown
- `epm.labelPrefix` in `dashboard-config.json` controls the label autocomplete filter in the EPM settings canvas. Default is `"rnd_project_"`. The full matched label (e.g., `rnd_project_bsw`) is what the rollup query uses — the prefix is only a UI filter. Never hardcode `rnd_project_` in JQL builders.
```

- [ ] **Step 2: `docs/features/epm-view.md` update.**

Document the Project model, the 2-hop rollup, label conventions, metadata-only behavior, and the custom-Project path.

- [ ] **Step 3: README.md EPM section update.**

Short operator note: where to set the prefix, how to add a Project, what the hierarchy rendering shows.

---

## Task 9: Full verification pass

- [ ] **Step 1: Run all Python and Node tests.**

```bash
.venv/bin/python -m unittest discover -s tests
node --test tests/test_epm_view_source_guards.js tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js tests/test_epm_project_utils.test.js
```

- [ ] **Step 2: Measure initial-load timing with EPM mode.**

Open DevTools Network tab, switch to EPM, confirm `/api/epm/projects` completes in under 5 seconds warm-cache-cold for a 20-project goal (down from 45s). `/api/epm/projects/preview` should match.

- [ ] **Step 3: Verify all AGENTS.md §10 bullets still hold.**

- [ ] **Step 4: Rebuild the frontend bundle, commit, and update the branch.**

```bash
npm run build
git add frontend/dist/dashboard.js frontend/dist/dashboard.css frontend/dist/dashboard.js.map
```

---

## Out of scope (explicitly not in this plan)

- Global fallback to match every `rnd_project_*` label. User rejected.
- Auto-derivation of the per-project prefix from the Home Goal name. User rejected; the user types/picks the label.
- Admin gating of settings routes. Still `TODO(SETTINGS_ADMIN_ONLY)` per prior plan.
- Home-side Jira linkage (Townsquare `extract_home_jira_linkage` stub). No Home schema change yet.
- Multiple labels per Project. Single label only. Multi-label is a follow-up if needed.
