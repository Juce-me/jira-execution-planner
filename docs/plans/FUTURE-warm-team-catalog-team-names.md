# Warm Team Catalog For ENG Team-Option Names Implementation Plan

> **Status:** Deferred follow-up. Severity: Minor. Spun out of `DONE-priority-refresh-preserve-team-filter.md`, which deliberately excluded any new initial-load request. Do not execute without renaming to `EXEC-*` after review.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the residual cold-load raw-team-id option name (a configured team with no tasks yet in the session and an unwarmed team catalog) with the team's catalog display name, without adding any unconditional initial-load request.

**Architecture:** Add one degradation-triggered effect beside the existing `teamOptions` memo: when a rendered non-`all` team option's name equals its raw id and the active group has configured team IDs, fetch `GET /api/team-catalog` once per session through the existing `fetchTeamCatalog` API helper and set only `teamCatalogState`. The existing `teamNameLookup` memo already folds catalog names in, and the `teamOptions` memo already depends on it, so options rename automatically when the response lands. The settings-owned `loadTeamCatalog()` path (which also mutates `availableTeams`) stays untouched.

**Tech Stack:** React 19, `frontend/src/api/jiraCatalogApi.js` `fetchTeamCatalog`, Playwright, esbuild-generated `frontend/dist`, Python `unittest` structural guards.

## Why This Is Minor

The degradation is cosmetic only: the filter selection is already preserved by `DONE-priority-refresh-preserve-team-filter.md`; the option merely shows its raw team id until tasks for that team arrive or Settings is opened. Pre-existing behavior was strictly worse (the team vanished and the filter reset).

## Global Constraints

- No unconditional initial-load request: `GET /api/team-catalog` may fire only after a rendered team option shows a raw-id name while `activeGroupTeamIds` is non-empty, and at most once per session.
- Reuse the existing `fetchTeamCatalog` helper (`frontend/src/api/jiraCatalogApi.js:26`, imported as `requestTeamCatalog` at `frontend/src/dashboard.jsx:166`); no new endpoint, no backend changes.
- The warm path sets only `teamCatalogState`; never call `setAvailableTeams` outside the settings-modal flow.
- Do not change `buildTeamOptionsForScope`, selection reconciliation, storage keys/payloads, priority APIs, or analytics events; automatic name resolution must not emit `filter_changed` or any new `userevent`.
- The Playwright fixture in `tests/ui/eng_priority_transitions.spec.js` must mock `GET /api/team-catalog` for every test in the file (the new effect can fire during existing cases whose configured `team-beta` has no tasks on cold load).
- Ratchet `LEGACY_ENTRYPOINT_LINE_BUDGETS['frontend/src/dashboard.jsx']` to the exact post-change `wc -l` integer with an itemized comment.
- Do not hand-edit `frontend/dist`; regenerate with `npm run build`.

## File Map

Modify:

- `frontend/src/dashboard.jsx` — one warm-on-degradation effect after the `teamNameById` memo.
- `tests/ui/eng_priority_transitions.spec.js` — `/api/team-catalog` fixture mock plus two regression tests.
- `tests/test_codebase_structure_budgets.py` — exact budget ratchet.
- `docs/README_ANALYTICS.md` — no-event allowlist row for the automatic warm fetch.
- `docs/plans/README.md` — flip this plan's entry to executed status.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map` — regenerate.

---

## Task 1: Degradation-Triggered Catalog Warm With Playwright Proof

**Files:**

- Modify: `frontend/src/dashboard.jsx` (immediately after the `teamNameById` memo that follows the `teamOptions` memo, currently near line 6391)
- Modify: `tests/ui/eng_priority_transitions.spec.js`
- Modify: `tests/test_codebase_structure_budgets.py`

**Interfaces:**

- Consumes: `teamOptions: Array<{id, name}>`, `activeGroupTeamIds: Array<string>`, `requestTeamCatalog(BACKEND_URL)`, `setTeamCatalogState`.
- Produces: no new exports; the effect is internal to the dashboard component.

- [ ] **Step 1: Add the failing regression test for the cold-load raw-id name**

In `tests/ui/eng_priority_transitions.spec.js`, add:

```js
test('cold load warms the team catalog once when a configured team has no tasks', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ showPlanning: true }));
    const { calls } = await installEngPriorityFixture(page);
    await page.goto(appBaseUrl);

    const teamToggle = page.locator('.view-selector .team-dropdown-toggle').first();
    await teamToggle.click();
    await expect(page.locator('.team-dropdown-panel')).toContainText('Beta Team');
    expect(calls.filter(call => call.pathname === '/api/team-catalog').length).toBe(1);
});
```

The default fixture stories are both `team-alpha`, so configured `team-beta` is taskless on cold load — exactly the degraded state.

- [ ] **Step 2: Run the new test and observe the honest failure**

Run: `npx playwright test tests/ui/eng_priority_transitions.spec.js -g "warms the team catalog"`
Expected: FAIL — the dropdown panel shows the raw `team-beta` id (no catalog warm exists yet) and zero `/api/team-catalog` calls are recorded.

- [ ] **Step 3: Mock the catalog endpoint in the shared fixture**

In `installEngPriorityFixture`'s route dispatcher, beside the other `url.pathname` branches, add:

```js
if (url.pathname === '/api/team-catalog') {
    return json(route, {
        catalog: {
            'team-alpha': { name: 'Alpha Team' },
            'team-beta': { name: 'Beta Team' }
        },
        meta: {}
    });
}
```

- [ ] **Step 4: Add the warm-on-degradation effect**

In `frontend/src/dashboard.jsx`, immediately after the `teamNameById` memo, add:

```js
// Warm the team catalog once per session, and only when a configured team is
// visibly degraded to its raw id (no task-derived or catalog name yet). This
// keeps the initial load free of unconditional requests; the settings-owned
// loadTeamCatalog() path and availableTeams stay untouched.
const teamCatalogWarmRequestedRef = React.useRef(false);
React.useEffect(() => {
    if (teamCatalogWarmRequestedRef.current) return;
    if (!(activeGroupTeamIds || []).length) return;
    const hasRawIdName = teamOptions.some(team => team.id !== 'all' && team.name === team.id);
    if (!hasRawIdName) return;
    teamCatalogWarmRequestedRef.current = true;
    let cancelled = false;
    (async () => {
        try {
            const response = await requestTeamCatalog(BACKEND_URL);
            if (!response.ok || cancelled) return;
            const data = await response.json();
            setTeamCatalogState({
                catalog: data.catalog || {},
                meta: data.meta || {}
            });
        } catch (err) {
            console.warn('Failed to warm team catalog:', err);
        }
    })();
    return () => { cancelled = true; };
}, [teamOptions, activeGroupTeamIds]);
```

Single attempt per session by design (the ref is set before the request); a failed warm degrades to the current raw-id behavior, mirroring `loadTeamCatalog`'s silent-warn pattern.

- [ ] **Step 5: Run the new test again**

Run: `npx playwright test tests/ui/eng_priority_transitions.spec.js -g "warms the team catalog"`
Expected: PASS — panel renames to `Beta Team`, exactly one `/api/team-catalog` call.

- [ ] **Step 6: Add the no-degradation guard test**

```js
test('team catalog is not requested when every configured team resolves a task name', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ showPlanning: true }));
    const { calls } = await installEngPriorityFixture(page, {
        stories: [
            makeStory('PROD-1', activeSprintId, activeSprintName),
            makeStory('PROD-BETA-1', activeSprintId, activeSprintName, 'PROD-EPIC', 'team-beta', 'Beta Team')
        ]
    });
    await page.goto(appBaseUrl);

    const teamToggle = page.locator('.view-selector .team-dropdown-toggle').first();
    await teamToggle.click();
    await expect(page.locator('.team-dropdown-panel')).toContainText('Beta Team');
    expect(calls.filter(call => call.pathname === '/api/team-catalog').length).toBe(0);
});
```

- [ ] **Step 7: Run the full spec file**

Run: `npx playwright test tests/ui/eng_priority_transitions.spec.js`
Expected: all cases pass, including both new tests and every pre-existing case (the fixture mock keeps cases where the effect fires from hitting an unmocked route).

- [ ] **Step 8: Ratchet the structural budget**

Run: `wc -l frontend/src/dashboard.jsx`
Set `LEGACY_ENTRYPOINT_LINE_BUDGETS['frontend/src/dashboard.jsx']` in `tests/test_codebase_structure_budgets.py` to that exact integer and extend the itemized comment with one line for the warm effect.

Run: `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/dashboard.jsx tests/ui/eng_priority_transitions.spec.js tests/test_codebase_structure_budgets.py
git commit -m "fix: warm team catalog when a team option lacks a name"
```

---

## Task 2: Analytics Rationale, Build, And Full Verification

**Files:**

- Modify: `docs/README_ANALYTICS.md`
- Modify: `docs/plans/README.md`
- Modify: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`

**Interfaces:** None. Documentation and generated assets only.

- [ ] **Step 1: Add the no-event allowlist row**

Add under `### No-Event Allowlist` in `docs/README_ANALYTICS.md`:

```markdown
| Degradation-triggered team catalog warm | `frontend/src/dashboard.jsx` | Automatic corrective fetch that fires at most once per session, only when a configured team option lacks a display name; no user action is introduced and no `userevent` is emitted. The response carries only the local team-name catalog; no team IDs, issue keys, or Jira URLs are sent to analytics. | <execution date> |
```

Replace `<execution date>` with the actual date when executed.

- [ ] **Step 2: Rebuild and verify**

```bash
npm run build
node --test tests/test_team_selection_utils.js tests/test_team_selection_persistence.js tests/test_planning_selection_stats.js tests/test_planning_selection_state.js
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
npx playwright test tests/ui/eng_priority_transitions.spec.js
npm run test:frontend:unit
.venv/bin/python -m unittest discover -s tests
```

Expected: every command passes (frontend-unit dist-parity guards require running after the dist rebuild is committed together with source, or re-running post-commit as documented in `DONE-priority-refresh-preserve-team-filter.md`).

- [ ] **Step 3: Update the plan index and commit**

Flip this plan's entry in `docs/plans/README.md` to executed status, then:

```bash
git add docs/README_ANALYTICS.md docs/plans/README.md docs/plans/FUTURE-warm-team-catalog-team-names.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "docs: record team catalog warm-up contract"
```

## Acceptance Criteria

- Cold load with a configured, taskless team renames that option from its raw id to the catalog display name once the single warm response lands; the selection itself is never touched.
- No `/api/team-catalog` request occurs when every configured team already resolves a name; at most one request per session in the degraded case.
- `availableTeams` is never mutated outside the settings-modal flow.
- All pre-existing cases in `tests/ui/eng_priority_transitions.spec.js` still pass; full frontend unit and Python suites pass; dist regenerated; budget exact.

## Plan Self-Review

- Single subsystem (one effect + fixture/tests + docs); no split needed.
- No placeholders: every step carries exact code or exact commands (the allowlist date is deliberately deferred to execution).
- Interface names verified against the current source: `requestTeamCatalog` import (`dashboard.jsx:166`), `setTeamCatalogState` (used by `loadTeamCatalog`, `dashboard.jsx:2106-2122`), `teamNameLookup` memo consuming `teamCatalogState`, `teamOptions` memo depending on `teamNameLookup`, backend route `backend/routes/settings_routes.py:485`.
- Jira pagination contract: not applicable — the one touched endpoint is a local catalog read; no Jira REST calls are added.
