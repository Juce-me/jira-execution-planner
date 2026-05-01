# EPM Project Configuration Tab and Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move EPM project mapping into a dedicated Projects sub-tab that opens only after the draft sub-goal and label prefix are set, preserves the saved sub-goal, and auto-loads cached Jira Home projects as configuration inputs for EPM rollups.

**Architecture:** Keep the top-level Dashboard Settings tab as `EPM`, then add EPM-local sub-tabs: `Scope` for Atlassian site/root/sub-goal/prefix and `Projects` for Jira Home project label mapping. Cache sub-goals by root in the frontend so reopening settings does not refetch them, and split backend EPM project caching so Jira Home project records are cached by scope while label mappings are shaped from the latest config on every response. The Projects tab gives users an explicit `Refresh from Jira Home` recovery path when a newly linked Project is missing: refresh bypasses the Home-project cache, reconciles new/missing Home projects with existing configuration, and preserves saved/custom mappings until the user removes them. The sub-goal is the project-catalog root; configured project labels plus the selected sprint define the Jira structure fetched for EPM rollups. Jira teams and team groups must not participate in EPM rollup scope.

**Spec:** No separate design spec exists for this settings-cache follow-up. It is a settings workflow correction related to `docs/plans/2026-04-27-epm-active-sprint-visibility.md`; it is not the portfolio rollup implementation from `docs/superpowers/specs/2026-04-27-epm-multi-project-rollup-design.md`.

**Tech Stack:** React 19, esbuild, Node `node:test` source guards, Python `unittest`, Flask.

---

## Diagnosis

Sub-goals load again because `frontend/src/dashboard.jsx` clears the sub-goal options inside the EPM settings open effect and then calls `loadEpmSubGoalsForRoot(rootGoalKey, savedSubGoalKey)` every time the EPM tab opens. There is no frontend cache keyed by root goal, so the saved child goal is repeatedly fetched from Jira Home just to render a selected chip.

Projects are currently wired through preview-named state and endpoints, but that is the wrong model. The discovered Jira Home projects are configuration inputs: each project row stores the exact Jira label used later to fetch the rollup issue hierarchy, and the Active EPM view adds the selected sprint to that label scope. `loadEpmSettings` calls `resetEpmProjectPreview()`, the project rows stay in the same overloaded EPM tab, and `/api/epm/config` clears `EPM_PROJECTS_CACHE` on every save. That makes the UI lose the cached Jira Home project list exactly when project mapping is being configured.

The fix is to remove the preview mental model and make scope setup plus project mapping separate configuration states:

- `Scope` sub-tab: Atlassian site, root goal, sub-goal, label prefix.
- `Projects` sub-tab: always reachable, with auto-loaded direct Jira Home projects plus custom project rows; saved rows are EPM project configuration, not Jira team configuration.
- If `subGoalKey` or `labelPrefix` is missing, `Projects` shows a compact prerequisite state with direct actions back to the missing Scope fields.
- Opening EPM settings never clears `subGoalKey`.
- Changing the root goal to a different key clears `subGoalKey`; selecting the same root does not.
- Changing label prefix invalidates label autocomplete results, not the selected sub-goal.
- Jira Home project records are cached by scope and reused for settings project loading.
- When a user notices a missing Jira Home Project, they go to `Dashboard Settings -> EPM -> Projects` and click `Refresh from Jira Home`. The refresh bypasses the cached Home project records for the current root/sub-goal scope, adds newly discovered Home project rows with blank labels, preserves existing configured labels/names, keeps custom rows, and marks configured Home rows that are no longer present in the latest Home fetch instead of silently deleting them.
- EPM rollups continue to fetch Jira structure from configured labels and the selected sprint value; no team/group filter is added.

## Frontend/Backend Dependency Contract

Frontend settings depend on these backend contracts:

- `GET /api/epm/config` returns the saved normalized EPM scope, label prefix, issue type buckets, and project mappings.
- `GET /api/epm/scope` returns Atlassian site metadata and the normalized saved EPM scope.
- `GET /api/epm/goals` returns root goals; `GET /api/epm/goals?rootGoalKey=...` returns sub-goals for the selected root goal.
- `POST /api/epm/projects/configuration` returns project configuration rows shaped from the posted draft config plus cached Jira Home project records.
- `POST /api/epm/projects/configuration?refresh=true` bypasses cached Jira Home project records for the draft scope, fetches the latest direct Jira Home projects, then shapes rows from the same posted draft config.
- `GET /api/epm/projects` returns saved main-view EPM project rows shaped from the saved config plus cached Jira Home project records.
- `GET /api/epm/projects?refresh=true` bypasses cached Jira Home project records for the saved scope, fetches the latest direct Jira Home projects, then shapes rows from the saved config.
- `POST /api/epm/config` persists scope/project mappings, clears rollup caches, and clears the Home-project cache only when the root/sub-goal scope changes.
- `GET /api/jira/labels?prefix=...` powers project-label autocomplete using `epm.labelPrefix`.
- `GET /api/epm/projects/:id/rollup?tab=&sprint=` powers main EPM rollups and must use configured project labels plus the Active sprint value, never Jira teams or team groups.

The frontend settings cache key intentionally includes `rootGoalKey`, `subGoalKey`, and `labelPrefix` because readiness, autocomplete, and visible project-row state all depend on the prefix. The backend Jira Home project cache key intentionally includes only `rootGoalKey` and `subGoalKey`, because Home project discovery does not depend on label prefix; labels are shaped from the latest config on every response.

## Files

- Modify: `frontend/src/epm/epmProjectUtils.mjs`
- Modify: `tests/test_epm_project_utils.js`
- Modify: `jira_server.py`
- Modify: `tests/test_epm_config_api.py`
- Modify: `tests/test_epm_projects_api.py`
- Modify: `tests/test_epm_rollup_api.py`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`
- Modify: `tests/test_epm_settings_source_guards.js`
- Modify: `tests/test_dashboard_css_extraction.py`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/ui/epm_settings_visual_states.spec.js`
- Generated by build: `frontend/dist/dashboard.js`
- Generated by build: `frontend/dist/dashboard.js.map`

Do not hand-edit `frontend/dist/dashboard.js` or `frontend/dist/dashboard.js.map`; regenerate them with `npm run build`. CSS exception: there is no CSS source file under `frontend/src`, and `frontend/dist/dashboard.css` is the served stylesheet/source of truth for CSS-only modal layout changes in this repo. The AGENTS.md generated-bundle rule applies to JS bundles and source maps here, not to `frontend/dist/dashboard.css`.

## Execution Granularity

Tasks 2, 4, and 6 contain several related edits because they are anchored to existing large files. Execute them exactly in their small checkbox steps, and stop at each task's test command before moving on. Task 5 is intentionally split into Task 5A for loader/cache behavior and Task 5B for render states/save reconciliation because it changes both state flow and JSX.

## Release Dependency

Do not start this settings implementation until the EPM Active sprint visibility work is merged into the target branch, or include that work in the same release before this plan. The Active EPM view must visibly show the selected sprint value because the configured project labels plus that sprint value define the Jira rollup scope. The dependency implementation plan is `docs/plans/2026-04-27-epm-active-sprint-visibility.md`.

Before Task 1, verify:

```bash
node --test tests/test_epm_view_source_guards.js
```

Expected: PASS with source guards proving the Active EPM controls expose the sprint picker/value and hide it outside Active.

If this verification fails, stop this settings plan and complete `docs/plans/2026-04-27-epm-active-sprint-visibility.md` first, including its build and visual verification steps. Do not weaken or delete the source guard to proceed with this settings work.

Also verify the existing project learning before Task 1:

```bash
rg -n "EPM settings.*configured project labels plus selected sprint" AGENTS.md
```

Expected: one existing line under `## 11. Project Learnings`. Do not add a duplicate learning.

Use the repo-documented Python command convention from AGENTS.md (`python3 -m unittest ...`). If a local shell lacks dependencies but `.venv/bin/python` has them installed, run the equivalent `.venv/bin/python -m unittest ...` command and record that substitution in the handoff notes.

## Pre-Flight: Acknowledge Baseline Stale Assertions

`tests/test_epm_settings_source_guards.js` currently contains assertions that became obsolete during prior refactors and assertions that this plan deliberately invalidates. Subagents must not "fix" them ad-hoc — every removal listed below is owned by an explicit step in this plan.

Run before Task 1:

```bash
node --test tests/test_epm_settings_source_guards.js 2>&1 | tail -30
```

Expected baseline failures (today, on the target branch):

- The first test (`dashboard source includes the EPM settings tab and lazy-load flow`) fails because it asserts `const loadEpmConfig = async () => {` but `frontend/src/dashboard.jsx:582` declares `loadEpmConfig` as a non-async one-liner (`const loadEpmConfig = () => fetchEpmConfig(BACKEND_URL);`). **This pre-existing failure is owned by Task 5A Step 1**, which deletes the stale assertion as part of the broader preview-era cleanup.

If any other failures appear, stop and reconcile with the plan before proceeding — the plan is sized against the failure set above.

The complete list of source-guard assertions this plan will delete from the first test in `tests/test_epm_settings_source_guards.js` (line numbers reflect today's file; do not rely on them after edits — match by string):

- `assert.ok(dashboardSource.includes('const loadEpmConfig = async () => {'), 'Expected EPM config loader');` — owned by Task 5A Step 1.
- `assert.ok(dashboardSource.includes('const loadEpmProjectPreview = async (draftConfig) => {'), 'Expected EPM draft preview loader');` — owned by Task 5A Step 1.
- `assert.ok(dashboardSource.includes('const childGoalState = await loadEpmSubGoalsForRoot(rootGoalKey, savedSubGoalKey);'), 'Expected child-goal validation before initial EPM project loading');` — owned by Task 3 Step 1.
- `assert.ok(dashboardSource.includes('if (!cancelled && savedSubGoalKey && !childGoalState.lookupFailed && !childGoalState.hasExpectedSubGoal && loadedConfig) {'), 'Expected invalid saved sub-goal reconciliation only on confirmed lookup success');` — owned by Task 3 Step 1.
- `assert.ok(dashboardSource.includes('return { goals: [], hasExpectedSubGoal: true, lookupFailed: true };'), 'Expected child-goal lookup failures to preserve saved scope instead of treating it as invalid');` — owned by Task 3 Step 1.
- `assert.ok(dashboardSource.includes("subGoalKey: '',"), 'Expected invalid saved sub-goal reconciliation to clear the draft');` — owned by Task 3 Step 1.
- `assert.ok(!dashboardSource.includes('epmConfigBaselineRef.current = JSON.stringify(reconciledConfig);'), 'Did not expect invalid sub-goal reconciliation to rewrite the saved baseline');` — owned by Task 3 Step 1 (the negation stays valid but the surrounding context is gone; remove for clarity).
- `assert.ok(dashboardSource.includes("updateEpmScopeDraft('subGoalKey', '')"), 'Expected root-goal flow to clear the sub-goal draft');` — owned by Task 3 Step 1 (Task 3 Step 9 replaces `updateEpmScopeDraft('subGoalKey', '')` with an inline `setEpmConfigDraft((prev) => ({ ..., scope: { ..., subGoalKey: rootChanged ? '' : prev.scope?.subGoalKey || '' } }))`).
- `assert.ok(dashboardSource.includes('if (hasSavedEpmScopeConfig(nextConfig)) {') && dashboardSource.includes('const nextProjects = await refreshEpmProjects();') && dashboardSource.includes('setEpmSettingsProjects(nextProjects);') && dashboardSource.includes('setEpmProjects([]);'), 'Expected save path to refresh only when saved scope exists and replace settings preview rows');` — owned by Task 5A Step 1 (Task 5A Step 10 replaces the post-save success branch; the `setEpmSettingsProjects(nextProjects)` clause no longer holds).
- `assert.ok(dashboardSource.includes('Run Test Configuration to preview projects for the selected draft scope.'), 'Expected explicit preview helper copy before settings preview runs');` — owned by Task 5A Step 1.
- `assert.ok(dashboardSource.includes('void previewEpmProjectSettings().catch(() => {});'), 'Expected EPM Test Configuration button to drive draft preview');` — owned by Task 5A Step 1.
- `assert.ok(dashboardSource.includes('setEpmSettingsProjects([]);') && dashboardSource.includes('setEpmSettingsProjectsError(\'\');'), 'Expected scope changes and settings load to clear stale preview rows');` — owned by Task 5A Step 1 (the cleared-on-scope-change behavior is replaced by the cache-key reset effect added in Task 5A Step 6).

Each affected step (Task 3 Step 1 and Task 5A Step 1) lists its deletions explicitly. If a deletion is missing or duplicated in those steps relative to this baseline, treat the per-task list as authoritative and update this Pre-Flight summary.

## Task 1: Add Frontend Readiness and Cache-Key Helpers

**Files:**
- Modify: `frontend/src/epm/epmProjectUtils.mjs`
- Modify: `tests/test_epm_project_utils.js`

- [ ] **Step 1: Write failing utility tests**

Append this test to `tests/test_epm_project_utils.js`:

```js
test('EPM settings project readiness and cache key use sub-goal plus prefix', async () => {
    const {
        getEpmProjectPrerequisites,
        getEpmSettingsProjectsCacheKey,
        isEpmProjectsConfigReady,
        normalizeEpmSettingsKeyPart
    } = await import(helperUrl);

    assert.strictEqual(normalizeEpmSettingsKeyPart(' child-34 '), 'CHILD-34');
    assert.strictEqual(normalizeEpmSettingsKeyPart(null), '');

    const config = {
        labelPrefix: ' rnd_project_ ',
        scope: {
            rootGoalKey: ' root-223 ',
            subGoalKey: ' child-34 '
        }
    };

    assert.strictEqual(isEpmProjectsConfigReady(config), true);
    assert.strictEqual(
        getEpmSettingsProjectsCacheKey(config),
        'ROOT-223::CHILD-34::rnd_project_'
    );

    assert.strictEqual(isEpmProjectsConfigReady({ ...config, labelPrefix: ' ' }), false);
    assert.deepStrictEqual(getEpmProjectPrerequisites({ ...config, labelPrefix: ' ' }), ['labelPrefix']);
    assert.strictEqual(
        isEpmProjectsConfigReady({ ...config, scope: { rootGoalKey: 'ROOT-223', subGoalKey: '' } }),
        false
    );
    assert.deepStrictEqual(
        getEpmProjectPrerequisites({ ...config, scope: { rootGoalKey: 'ROOT-223', subGoalKey: '' } }),
        ['subGoal']
    );
    assert.deepStrictEqual(getEpmProjectPrerequisites({}), ['subGoal', 'labelPrefix']);
    assert.strictEqual(getEpmSettingsProjectsCacheKey({}), '');
});
```

- [ ] **Step 2: Run the utility test and confirm it fails**

Run:

```bash
node --test tests/test_epm_project_utils.js
```

Expected: FAIL mentioning `getEpmSettingsProjectsCacheKey` or `isEpmProjectsConfigReady` is not exported.

- [ ] **Step 3: Add the helpers**

Append these exports to `frontend/src/epm/epmProjectUtils.mjs`:

```js
export function normalizeEpmSettingsKeyPart(value) {
    return String(value || '').trim().toUpperCase();
}

export function isEpmProjectsConfigReady(config) {
    const subGoalKey = normalizeEpmSettingsKeyPart(config?.scope?.subGoalKey);
    const labelPrefix = String(config?.labelPrefix || '').trim();
    return Boolean(subGoalKey && labelPrefix);
}

export function getEpmProjectPrerequisites(config) {
    const missing = [];
    if (!normalizeEpmSettingsKeyPart(config?.scope?.subGoalKey)) {
        missing.push('subGoal');
    }
    if (!String(config?.labelPrefix || '').trim()) {
        missing.push('labelPrefix');
    }
    return missing;
}

export function getEpmSettingsProjectsCacheKey(config) {
    if (!isEpmProjectsConfigReady(config)) return '';
    return [
        normalizeEpmSettingsKeyPart(config?.scope?.rootGoalKey),
        normalizeEpmSettingsKeyPart(config?.scope?.subGoalKey),
        String(config?.labelPrefix || '').trim()
    ].join('::');
}
```

- [ ] **Step 4: Run the utility test and confirm it passes**

Run:

```bash
node --test tests/test_epm_project_utils.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/epm/epmProjectUtils.mjs tests/test_epm_project_utils.js
git commit -m "test(epm): add project settings cache helpers"
```

## Task 2: Cache Jira Home Projects Separately From Label Mapping

**Files:**
- Modify: `jira_server.py`
- Modify: `tests/test_epm_config_api.py`
- Modify: `tests/test_epm_projects_api.py`
- Modify: `tests/test_epm_rollup_api.py`

This task fixes the backend quality issue: keeping the existing shaped `EPM_PROJECTS_CACHE` across config saves would preserve stale labels. Cache the raw Jira Home project records by scope, then shape each response with the latest normalized EPM config.

- [ ] **Step 1: Write failing config-cache tests**

In `tests/test_epm_config_api.py`, update the saved dashboard config inside `test_post_epm_config_persists_projects_without_overwriting_team_groups` so this test is specifically a same-scope label/config save, not a first-time scope save:

```python
            json.dump(
                {
                    'version': 1,
                    'projects': {'selected': []},
                    'teamGroups': {'version': 1, 'groups': []},
                    'epm': {
                        'version': 2,
                        'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
                        'labelPrefix': 'rnd_project_',
                        'projects': {},
                    },
                },
                handle,
            )
```

Then replace the cache assertions inside that test with:

```python
            self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {'dummy': {'value': 1}})
            self.assertEqual(jira_server.EPM_ISSUES_CACHE, {})
            self.assertEqual(jira_server.TASKS_CACHE, {'dummy': {'value': 3}})
```

Then add these test methods to the same class so first-scope saves and actual scope changes still clear the Home-project cache:

```python
    def test_post_epm_config_clears_project_cache_when_scope_is_added(self):
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(
                {
                    'version': 1,
                    'projects': {'selected': []},
                    'teamGroups': {'version': 1, 'groups': []},
                },
                handle,
            )

        with patch.object(jira_server, 'EPM_PROJECTS_CACHE', {'old-empty-scope': {'value': 1}}), \
             patch.object(jira_server, 'EPM_ISSUES_CACHE', {'old-issues': {'value': 2}}), \
             patch.object(jira_server, 'EPM_ROLLUP_CACHE', {'old-rollup': {'value': 3}}):
            response = self.client.post(
                '/api/epm/config',
                json={
                    'scope': {'rootGoalKey': 'ROOT-NEW', 'subGoalKey': 'CHILD-NEW'},
                    'labelPrefix': 'rnd_project_',
                    'projects': {},
                },
            )

            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {})
            self.assertEqual(jira_server.EPM_ISSUES_CACHE, {})
            self.assertEqual(jira_server.EPM_ROLLUP_CACHE, {})
```

```python
    def test_post_epm_config_clears_project_cache_when_scope_changes(self):
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(
                {
                    'version': 1,
                    'projects': {'selected': []},
                    'teamGroups': {'version': 1, 'groups': []},
                    'epm': {
                        'version': 2,
                        'scope': {'rootGoalKey': 'ROOT-OLD', 'subGoalKey': 'CHILD-OLD'},
                        'labelPrefix': 'rnd_project_',
                        'projects': {},
                    },
                },
                handle,
            )

        with patch.object(jira_server, 'EPM_PROJECTS_CACHE', {'old-scope': {'value': 1}}), \
             patch.object(jira_server, 'EPM_ISSUES_CACHE', {'old-issues': {'value': 2}}), \
             patch.object(jira_server, 'EPM_ROLLUP_CACHE', {'old-rollup': {'value': 3}}):
            response = self.client.post(
                '/api/epm/config',
                json={
                    'scope': {'rootGoalKey': 'ROOT-NEW', 'subGoalKey': 'CHILD-NEW'},
                    'labelPrefix': 'rnd_project_',
                    'projects': {},
                },
            )

            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {})
            self.assertEqual(jira_server.EPM_ISSUES_CACHE, {})
            self.assertEqual(jira_server.EPM_ROLLUP_CACHE, {})
```

- [ ] **Step 2: Write failing projects-cache tests**

In `tests/test_epm_projects_api.py`, add this test method near the existing cache tests:

```python
    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_cache_reuses_home_records_but_shapes_latest_labels(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = self._home_projects()
        mock_get_epm_config.side_effect = [
            {
                'version': 2,
                'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
                'labelPrefix': 'rnd_project_',
                'projects': {
                    'tsq-1': {
                        'id': 'tsq-1',
                        'homeProjectId': 'tsq-1',
                        'name': 'Synthetic Launch',
                        'label': 'first_label',
                    }
                },
            },
            {
                'version': 2,
                'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
                'labelPrefix': 'rnd_project_',
                'projects': {
                    'tsq-1': {
                        'id': 'tsq-1',
                        'homeProjectId': 'tsq-1',
                        'name': 'Synthetic Launch',
                        'label': 'second_label',
                    }
                },
            },
        ]

        first_response = self.client.get('/api/epm/projects')
        second_response = self.client.get('/api/epm/projects')

        self.assertEqual(first_response.status_code, 200, first_response.get_data(as_text=True))
        self.assertEqual(second_response.status_code, 200, second_response.get_data(as_text=True))
        self.assertEqual(mock_fetch_projects.call_count, 1)
        first_project = first_response.get_json()['projects'][0]
        second_project = second_response.get_json()['projects'][0]
        self.assertEqual(first_project['resolvedLinkage']['labels'], ['first_label'])
        self.assertEqual(second_project['resolvedLinkage']['labels'], ['second_label'])
```

Add this saved-config refresh test to prove `GET /api/epm/projects?refresh=true` bypasses cached Home projects for the same saved scope:

```python
    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_refresh_bypasses_cached_home_projects(self, mock_fetch_projects, mock_get_epm_config):
        first_home_projects = [self._home_projects()[0]]
        refreshed_home_projects = [self._home_projects()[1]]
        mock_fetch_projects.side_effect = [first_home_projects, refreshed_home_projects]
        mock_get_epm_config.return_value = {
            'version': 2,
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'labelPrefix': 'rnd_project_',
            'projects': {},
        }

        first_response = self.client.get('/api/epm/projects')
        cached_response = self.client.get('/api/epm/projects')
        refreshed_response = self.client.get('/api/epm/projects?refresh=true')

        self.assertEqual(first_response.status_code, 200, first_response.get_data(as_text=True))
        self.assertEqual(cached_response.status_code, 200, cached_response.get_data(as_text=True))
        self.assertEqual(refreshed_response.status_code, 200, refreshed_response.get_data(as_text=True))
        self.assertEqual(mock_fetch_projects.call_count, 2)
        self.assertEqual(first_response.get_json()['projects'][0]['homeProjectId'], 'home-1')
        self.assertEqual(cached_response.get_json()['projects'][0]['homeProjectId'], 'home-1')
        self.assertEqual(refreshed_response.get_json()['projects'][0]['homeProjectId'], 'home-2')
        self.assertFalse(first_response.get_json()['cacheHit'])
        self.assertTrue(cached_response.get_json()['cacheHit'])
        self.assertFalse(refreshed_response.get_json()['cacheHit'])
```

Add this draft-config refresh test to prove `POST /api/epm/projects/configuration?refresh=true` bypasses cached Home projects while preserving draft labels:

```python
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_configuration_refresh_bypasses_cache_and_preserves_draft_labels(self, mock_fetch_projects):
        first_home_projects = [self._home_projects()[0]]
        refreshed_home_projects = [self._home_projects()[0], self._home_projects()[1]]
        mock_fetch_projects.side_effect = [first_home_projects, refreshed_home_projects]
        draft_config = self._mixed_config()

        first_response = self.client.post('/api/epm/projects/configuration', json=draft_config)
        cached_response = self.client.post('/api/epm/projects/configuration', json=draft_config)
        refreshed_response = self.client.post('/api/epm/projects/configuration?refresh=true', json=draft_config)

        self.assertEqual(first_response.status_code, 200, first_response.get_data(as_text=True))
        self.assertEqual(cached_response.status_code, 200, cached_response.get_data(as_text=True))
        self.assertEqual(refreshed_response.status_code, 200, refreshed_response.get_data(as_text=True))
        self.assertEqual(mock_fetch_projects.call_count, 2)
        refreshed_projects = refreshed_response.get_json()['projects']
        self.assertEqual([project['homeProjectId'] for project in refreshed_projects[:2]], ['home-1', 'home-2'])
        home_two = next(project for project in refreshed_projects if project['homeProjectId'] == 'home-2')
        self.assertEqual(home_two['resolvedLinkage']['labels'], ['synthetic_label_home_two'])
        self.assertFalse(first_response.get_json()['cacheHit'])
        self.assertTrue(cached_response.get_json()['cacheHit'])
        self.assertFalse(refreshed_response.get_json()['cacheHit'])
```

Rename `test_projects_preview_endpoint_uses_draft_payload_without_saved_config_or_cache` to `test_projects_configuration_endpoint_uses_draft_payload_without_saved_config` and change the request path from `/api/epm/projects/preview` to `/api/epm/projects/configuration`. Keep the existing assertions that saved config is not read, and replace the cache assertions that expect `saved-config` to remain the only cache entry with:

```python
        self.assertGreaterEqual(len(jira_server.EPM_PROJECTS_CACHE), 1)
        self.assertIn('saved-config', jira_server.EPM_PROJECTS_CACHE)
```

- [ ] **Step 3: Strengthen the EPM rollup scope contract test**

In `tests/test_epm_rollup_api.py`, update `test_active_sprint_filter_is_appended_to_every_query_and_sprint_reaches_response` so the root rollup query starts from the configured project label, every generated Active query uses the selected sprint, and no generated query uses Jira team fields:

```python
        self.assertEqual(response.status_code, 200)
        jql_queries = [call.args[0] for call in mock_fetch.call_args_list]
        self.assertIn('labels = "synthetic_label_alpha"', jql_queries[0])
        for jql in jql_queries:
            self.assertIn('Sprint = 42', jql)
            self.assertNotIn('Team[Team]', jql)
            self.assertNotIn('"Team"', jql)
```

Keep the existing response assertions in that test. This guards the correction explicitly: EPM starts the Jira structure from configured labels, applies the selected sprint to Active queries, and does not add Jira team filters.

Add this source guard to `tests/test_epm_rollup_api.py` so future rollup refactors do not reintroduce team-group scope through helper imports or alternate names:

```python
    def test_epm_rollup_builder_does_not_reference_team_group_scope(self):
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[1]
        source = (repo_root / 'epm_rollup.py').read_text(encoding='utf-8')

        for forbidden in (
            'teamGroups',
            'team_groups',
            'TEAM_FIELD',
            'Team[Team]',
            '"Team"',
            'get_team',
            'resolve_team',
        ):
            self.assertNotIn(forbidden, source)
```

- [ ] **Step 4: Run the backend tests and confirm they fail**

Run:

```bash
python3 -m unittest tests.test_epm_config_api tests.test_epm_projects_api tests.test_epm_rollup_api
```

Expected: FAIL showing that config save clears the project cache and/or that the projects endpoint returns stale shaped labels from cache.

- [ ] **Step 5: Add scoped Home project cache helpers**

Before editing helpers, verify the existing TTL constant:

```bash
rg -n "EPM_PROJECTS_CACHE_TTL_SECONDS = 300" jira_server.py
```

Expected: one existing definition near the module-level cache constants. If it is missing, add `EPM_PROJECTS_CACHE_TTL_SECONDS = 300` next to `EPM_PROJECTS_CACHE = {}` before using it.

In `jira_server.py`, replace `clear_epm_caches` with these helpers:

```python
def build_epm_home_projects_cache_key(epm_scope):
    scope = epm_scope if isinstance(epm_scope, dict) else {}
    return json.dumps({
        'rootGoalKey': normalize_epm_upper_text(scope.get('rootGoalKey')),
        'subGoalKey': normalize_epm_upper_text(scope.get('subGoalKey')),
    }, sort_keys=True)


def clear_epm_project_cache():
    with _epm_cache_lock:
        EPM_PROJECTS_CACHE.clear()


def clear_epm_rollup_caches():
    with _epm_cache_lock:
        EPM_ISSUES_CACHE.clear()
        EPM_ROLLUP_CACHE.clear()


def clear_epm_caches():
    with _epm_cache_lock:
        EPM_PROJECTS_CACHE.clear()
        EPM_ISSUES_CACHE.clear()
        EPM_ROLLUP_CACHE.clear()
```

Place these helpers after `find_epm_config_row`. The backend cache key uses only root/sub-goal scope; it deliberately does not include `labelPrefix`.

```python
def build_epm_home_projects_state(epm_scope, force_refresh=False):
    cache_key = build_epm_home_projects_cache_key(epm_scope)
    if not force_refresh:
        with _epm_cache_lock:
            cached = EPM_PROJECTS_CACHE.get(cache_key)
            if cached and (time.time() - cached['timestamp']) < EPM_PROJECTS_CACHE_TTL_SECONDS:
                return {
                    'homeProjects': cached.get('homeProjects', []),
                    'cacheHit': True,
                    'fetchedAt': cached.get('fetchedAt', ''),
                    'homeProjectCount': len(cached.get('homeProjects', [])),
                    'homeProjectLimit': cached.get('homeProjectLimit'),
                    'possiblyTruncated': bool(cached.get('possiblyTruncated')),
                }

    home_projects = fetch_epm_home_projects(epm_scope)
    home_project_limit = epm_home.HOME_MAX_PROJECTS_PER_GOAL
    possibly_truncated = bool(home_project_limit and len(home_projects) >= home_project_limit)
    fetched_at = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    with _epm_cache_lock:
        EPM_PROJECTS_CACHE[cache_key] = {
            'timestamp': time.time(),
            'fetchedAt': fetched_at,
            'homeProjects': home_projects,
            'homeProjectLimit': home_project_limit,
            'possiblyTruncated': possibly_truncated,
        }
    return {
        'homeProjects': home_projects,
        'cacheHit': False,
        'fetchedAt': fetched_at,
        'homeProjectCount': len(home_projects),
        'homeProjectLimit': home_project_limit,
        'possiblyTruncated': possibly_truncated,
    }


def get_cached_epm_home_projects(epm_scope, force_refresh=False):
    return build_epm_home_projects_state(epm_scope, force_refresh=force_refresh)['homeProjects']
```

- [ ] **Step 6: Shape payloads from current config every time**

Change `build_epm_projects_payload` to accept a refresh flag and use cached raw Home projects:

```python
def build_epm_projects_payload(epm_config, force_refresh=False):
    normalized_config = normalize_epm_config(epm_config or {})
    projects = []
    epm_scope = normalized_config.get('scope') or {}
    home_state = build_epm_home_projects_state(epm_scope, force_refresh=force_refresh)
    returned_home_project_ids = set()
    for home_project in home_state['homeProjects']:
        project_id = home_project.get('homeProjectId')
        if project_id:
            returned_home_project_ids.add(project_id)
        config_row = find_epm_config_row(normalized_config['projects'], project_id)
        projects.append(build_epm_project_payload(home_project, config_row))
    for row in normalized_config['projects'].values():
        home_project_id = normalize_epm_text(row.get('homeProjectId'))
        if home_project_id and home_project_id in returned_home_project_ids:
            continue
        if home_project_id:
            missing_home_row = build_custom_project_payload(row)
            missing_home_row['homeProjectId'] = home_project_id
            missing_home_row['missingFromHomeFetch'] = True
            missing_home_row['matchState'] = 'missing-home-project'
            projects.append(missing_home_row)
            continue
        projects.append(build_custom_project_payload(row))
    return {
        'projects': projects,
        'cacheHit': home_state['cacheHit'],
        'fetchedAt': home_state['fetchedAt'],
        'homeProjectCount': home_state['homeProjectCount'],
        'homeProjectLimit': home_state['homeProjectLimit'],
        'possiblyTruncated': home_state['possiblyTruncated'],
    }
```

Replace `find_epm_project_or_404` with:

```python
def find_epm_project_or_404(project_id):
    epm_config = get_epm_config()
    epm_scope = epm_config.get('scope') or {}
    config_row = find_epm_config_row(epm_config['projects'], project_id)

    if config_row is not None:
        home_project_id = normalize_epm_text(config_row.get('homeProjectId'))
        if not home_project_id:
            return build_custom_project_payload(config_row)
        for home_project in get_cached_epm_home_projects(epm_scope):
            if home_project.get('homeProjectId') == home_project_id:
                return build_epm_project_payload(home_project, config_row)

    for home_project in get_cached_epm_home_projects(epm_scope):
        if home_project.get('homeProjectId') == project_id:
            config_row = find_epm_config_row(epm_config['projects'], project_id)
            return build_epm_project_payload(home_project, config_row)

    abort(404)
```

- [ ] **Step 7: Wire refresh support into project configuration endpoints**

Update `/api/epm/projects` and add `/api/epm/projects/configuration`. Keep the old `/api/epm/projects/preview` route as a compatibility alias for now, but no frontend code may call it.

```python
@app.route('/api/epm/projects', methods=['GET'])
def get_epm_projects_endpoint():
    epm_config = get_epm_config()
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    return jsonify(build_epm_projects_payload(epm_config, force_refresh=force_refresh))


@app.route('/api/epm/projects/configuration', methods=['POST'])
def configure_epm_projects_endpoint():
    payload = normalize_epm_config(request.get_json(silent=True) or {})
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    return jsonify(build_epm_projects_payload(payload, force_refresh=force_refresh))


@app.route('/api/epm/projects/preview', methods=['POST'])
def preview_epm_projects_endpoint():
    return configure_epm_projects_endpoint()
```

- [ ] **Step 8: Stop clearing Home project cache on label-only saves**

Inside `save_epm_config_endpoint`, capture the previous config before overwriting `dashboard_config['epm']`, then clear only the right caches:

```python
        dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
        previous_epm_config = normalize_epm_config(dashboard_config.get('epm') or {})
        previous_scope_key = build_epm_home_projects_cache_key(previous_epm_config.get('scope') or {})
        next_scope_key = build_epm_home_projects_cache_key(payload.get('scope') or {})
        dashboard_config['epm'] = payload
        save_dashboard_config(dashboard_config)
        if previous_scope_key != next_scope_key:
            clear_epm_project_cache()
        clear_epm_rollup_caches()
```

- [ ] **Step 9: Run backend tests and confirm they pass**

Run:

```bash
python3 -m unittest tests.test_epm_config_api tests.test_epm_projects_api tests.test_epm_rollup_api tests.test_epm_issues_endpoint
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add jira_server.py tests/test_epm_config_api.py tests/test_epm_projects_api.py tests/test_epm_rollup_api.py
git commit -m "fix(epm): cache Home projects by scope"
```

## Task 3: Stop Reloading and Clearing Saved Sub-Goals on Settings Open

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_epm_settings_source_guards.js`

- [ ] **Step 1: Write source guards for the desired sub-goal behavior**

In `tests/test_epm_settings_source_guards.js`, replace the test named `dashboard source keeps EPM settings preview draft-scoped and does not auto-load projects on open` with:

```js
test('dashboard source preserves saved EPM sub-goal on settings open', () => {
    const loadSettingsStart = dashboardSource.indexOf('const loadEpmSettings = async () => {');
    const loadSettingsEnd = dashboardSource.indexOf('loadEpmSettings();', loadSettingsStart);
    assert.ok(loadSettingsStart !== -1 && loadSettingsEnd !== -1, 'Expected EPM settings load effect block');
    const loadSettingsSource = dashboardSource.slice(loadSettingsStart, loadSettingsEnd);

    assert.ok(!loadSettingsSource.includes('clearEpmSubGoalOptions();'), 'EPM settings open must not clear saved sub-goal options');
    assert.ok(!loadSettingsSource.includes('loadEpmSubGoalsForRoot(rootGoalKey, savedSubGoalKey)'), 'EPM settings open must not refetch sub-goals just to render the saved chip');
    assert.ok(!loadSettingsSource.includes('resetEpmProjectPreview();'), 'EPM settings open must not use preview-named project reset state');
    assert.ok(!loadSettingsSource.includes('resetEpmSettingsProjectRows();'), 'EPM settings open must not erase cached project configuration rows');
    assert.ok(dashboardSource.includes('const epmSubGoalsCacheRef = useRef(new Map());'), 'Expected sub-goals cache by root goal');
    assert.ok(dashboardSource.includes('const resetEpmSettingsProjectRows = () => {'), 'Expected configuration-named project-row reset helper');
    assert.ok(dashboardSource.includes('return epmSubGoals.find((goal) => String(goal?.key || \'\').trim().toUpperCase() === key) || { key, name: key };'), 'Expected selected sub-goal fallback chip without refetch');
});

test('dashboard source clears EPM sub-goal only when root goal changes or user clears it', () => {
    const selectRootStart = dashboardSource.indexOf('const selectEpmRootGoal = async (goal) => {');
    const clearRootStart = dashboardSource.indexOf('const clearEpmRootGoal = () => {', selectRootStart);
    assert.ok(selectRootStart !== -1 && clearRootStart !== -1, 'Expected EPM root selection block');
    const selectRootSource = dashboardSource.slice(selectRootStart, clearRootStart);

    assert.ok(selectRootSource.includes('const rootChanged = previousRootGoalKey !== rootGoalKey;'), 'Expected same-root selection guard');
    assert.ok(selectRootSource.includes("subGoalKey: rootChanged ? '' : prev.scope?.subGoalKey || ''"), 'Expected sub-goal preservation when root did not change');
    assert.ok(selectRootSource.includes('if (rootChanged) {'), 'Expected sub-goal clear to be gated by actual root changes');
});
```

Also delete these assertions from the first source-guard test in `tests/test_epm_settings_source_guards.js` (`dashboard source includes the EPM settings tab and lazy-load flow`). Match by full assertion line, not by line number — the file shifts as edits land. Each line below is the entire `assert.ok(...);` statement to remove:

```js
assert.ok(dashboardSource.includes('const childGoalState = await loadEpmSubGoalsForRoot(rootGoalKey, savedSubGoalKey);'), 'Expected child-goal validation before initial EPM project loading');
assert.ok(dashboardSource.includes('if (!cancelled && savedSubGoalKey && !childGoalState.lookupFailed && !childGoalState.hasExpectedSubGoal && loadedConfig) {'), 'Expected invalid saved sub-goal reconciliation only on confirmed lookup success');
assert.ok(dashboardSource.includes('return { goals: [], hasExpectedSubGoal: true, lookupFailed: true };'), 'Expected child-goal lookup failures to preserve saved scope instead of treating it as invalid');
assert.ok(dashboardSource.includes("subGoalKey: '',"), 'Expected invalid saved sub-goal reconciliation to clear the draft');
assert.ok(!dashboardSource.includes('epmConfigBaselineRef.current = JSON.stringify(reconciledConfig);'), 'Did not expect invalid sub-goal reconciliation to rewrite the saved baseline');
assert.ok(dashboardSource.includes("updateEpmScopeDraft('subGoalKey', '')"), 'Expected root-goal flow to clear the sub-goal draft');
```

Insert in their place the narrower checks that root-clear and explicit sub-goal clear handlers exist:

```js
assert.ok(dashboardSource.includes('const clearEpmRootGoal = () => {'), 'Expected root clear handler');
assert.ok(dashboardSource.includes('const clearEpmSubGoal = () => {'), 'Expected explicit sub-goal clear handler');
```

- [ ] **Step 2: Run the source guard and confirm it fails**

Run:

```bash
node --test tests/test_epm_settings_source_guards.js
```

Expected: FAIL because the current settings open effect clears sub-goals and refetches them.

- [ ] **Step 3: Import the new helpers**

In `frontend/src/dashboard.jsx`, extend the existing EPM utility import:

```js
import {
    buildRollupTree,
    filterEpmProjectsForTab,
    getEpmProjectDisplayName,
    getEpmProjectIdentity,
    getEpmProjectPrerequisites,
    getEpmSettingsProjectsCacheKey,
    getEpmSprintHelper,
    hydrateEpmProjectDraft,
    isEpmProjectsConfigReady,
    shouldUseEpmSprint
} from './epm/epmProjectUtils.mjs';
```

- [ ] **Step 4: Add sub-goal cache state**

Add this ref near `epmSubGoalsRequestIdRef`:

```js
const epmSubGoalsCacheRef = useRef(new Map());
```

- [ ] **Step 5: Rename preview reset helper**

Rename the settings project row reset helper from:

```js
const resetEpmProjectPreview = () => {
```

to:

```js
const resetEpmSettingsProjectRows = () => {
```

Update all callers in `frontend/src/dashboard.jsx`. This is only a visible settings-row reset; it must not clear `epmSettingsProjectsCacheRef.current`.

- [ ] **Step 6: Change `loadEpmSubGoalsForRoot` to use the cache**

Change the function signature and add cache reuse before the fetch:

```js
const loadEpmSubGoalsForRoot = async (rootGoalKey, expectedSubGoalKey = '', options = {}) => {
    const normalizedRootGoalKey = String(rootGoalKey || '').trim().toUpperCase();
    const normalizedExpectedSubGoalKey = String(expectedSubGoalKey || '').trim().toUpperCase();
    const forceRefresh = Boolean(options.forceRefresh);
    epmSubGoalsRequestIdRef.current += 1;
    const requestId = epmSubGoalsRequestIdRef.current;
    if (!normalizedRootGoalKey) {
        setEpmSubGoals([]);
        setEpmSubGoalsLoading(false);
        setEpmSubGoalsError('');
        return { goals: [], hasExpectedSubGoal: !normalizedExpectedSubGoalKey, lookupFailed: false };
    }
    if (!forceRefresh && epmSubGoalsCacheRef.current.has(normalizedRootGoalKey)) {
        const cachedGoals = epmSubGoalsCacheRef.current.get(normalizedRootGoalKey) || [];
        const hasExpectedSubGoal = !normalizedExpectedSubGoalKey
            || cachedGoals.some((goal) => String(goal?.key || '').trim().toUpperCase() === normalizedExpectedSubGoalKey);
        setEpmSubGoals(cachedGoals);
        setEpmSubGoalsLoading(false);
        setEpmSubGoalsError('');
        return { goals: cachedGoals, hasExpectedSubGoal, lookupFailed: false };
    }
    setEpmSubGoalsLoading(true);
    setEpmSubGoalsError('');
```

After `const nextGoals = Array.isArray(payload.goals) ? payload.goals : [];`, add:

```js
epmSubGoalsCacheRef.current.set(normalizedRootGoalKey, nextGoals);
```

Keep the existing stale-response guard and failure behavior.

- [ ] **Step 7: Stop clearing/refetching on settings open**

Inside `loadEpmSettings`, remove these calls:

```js
resetEpmSettingsProjectRows();
clearEpmSubGoalOptions();
```

Remove the second `clearEpmSubGoalOptions();` after config load.

Remove the whole block that calls:

```js
const childGoalState = await loadEpmSubGoalsForRoot(rootGoalKey, savedSubGoalKey);
```

Replace it with cached hydration only:

```js
if (!cancelled && rootGoalKey && epmSubGoalsCacheRef.current.has(rootGoalKey)) {
    setEpmSubGoals(epmSubGoalsCacheRef.current.get(rootGoalKey) || []);
}
```

- [ ] **Step 8: Preserve selected sub-goal chip without loaded options**

Change `selectedEpmSubGoal` to return a fallback object:

```js
const selectedEpmSubGoal = React.useMemo(() => {
    const key = String(epmConfigDraft.scope?.subGoalKey || '').trim().toUpperCase();
    if (!key) return null;
    return epmSubGoals.find((goal) => String(goal?.key || '').trim().toUpperCase() === key) || { key, name: key };
}, [epmConfigDraft.scope?.subGoalKey, epmSubGoals]);
```

- [ ] **Step 9: Clear sub-goal only on actual root changes**

Replace `selectEpmRootGoal` with:

```js
const selectEpmRootGoal = async (goal) => {
    const rootGoalKey = String(goal?.key || '').trim().toUpperCase();
    const previousRootGoalKey = String(epmConfigDraft.scope?.rootGoalKey || '').trim().toUpperCase();
    const rootChanged = previousRootGoalKey !== rootGoalKey;
    if (rootChanged) {
        resetEpmSettingsProjectRows();
    }
    setEpmConfigDraft((prev) => ({
        ...prev,
        scope: {
            ...(prev.scope || {}),
            rootGoalKey,
            subGoalKey: rootChanged ? '' : prev.scope?.subGoalKey || '',
        },
    }));
    setEpmRootGoalQuery('');
    setEpmSubGoalQuery('');
    setEpmRootGoalOpen(false);
    setEpmRootGoalIndex(0);
    if (rootChanged) {
        clearEpmSubGoalOptions();
    }
    if (!rootGoalKey) {
        return;
    }
    await loadEpmSubGoalsForRoot(rootGoalKey);
};
```

Keep `clearEpmRootGoal` and `clearEpmSubGoal` as explicit user actions that clear the sub-goal.

- [ ] **Step 10: Lazy-load sub-goals only when the picker is used**

In the sub-goal input `onFocus`, call the loader only when a root exists:

```js
onFocus={() => {
    if (!epmConfigDraft.scope?.rootGoalKey) return;
    setEpmSubGoalOpen(true);
    void loadEpmSubGoalsForRoot(epmConfigDraft.scope.rootGoalKey);
}}
```

- [ ] **Step 11: Run source guard and utility tests**

Run:

```bash
node --test tests/test_epm_settings_source_guards.js tests/test_epm_project_utils.js
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_epm_settings_source_guards.js
git commit -m "fix(epm): preserve settings sub-goal selection"
```

## Task 4: Add EPM Scope and Projects Sub-Tabs

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_epm_settings_source_guards.js`

- [ ] **Step 1: Write source guards for the new tab structure**

Append this test to `tests/test_epm_settings_source_guards.js`:

```js
test('dashboard source separates EPM scope and project mapping tabs', () => {
    assert.ok(dashboardSource.includes("const [epmSettingsTab, setEpmSettingsTab] = useState('scope');"), 'Expected EPM-local settings tab state');
    assert.ok(dashboardSource.includes('const epmProjectPrerequisites = React.useMemo(() => getEpmProjectPrerequisites(epmConfigDraft), [epmConfigDraft]);'), 'Expected Projects prerequisite state');
    assert.ok(dashboardSource.includes("className={`group-modal-tab ${epmSettingsTab === 'scope' ? 'active' : ''}`"), 'Expected EPM Scope sub-tab button');
    assert.ok(dashboardSource.includes("className={`group-modal-tab ${epmSettingsTab === 'projects' ? 'active' : ''}`"), 'Expected EPM Projects sub-tab button');
    assert.ok(!dashboardSource.includes("disabled={!canOpenEpmProjectsTab}"), 'Projects tab must stay clickable and show prerequisites inside the panel');
    assert.ok(dashboardSource.includes('role="tablist"'), 'Expected accessible EPM settings tablist');
    assert.ok(dashboardSource.includes('role="tab"'), 'Expected accessible EPM settings tabs');
    assert.match(dashboardSource, /aria-selected=\{epmSettingsTab === ['"]scope['"]\}/, 'Expected scope tab selected state');
    assert.match(dashboardSource, /aria-selected=\{epmSettingsTab === ['"]projects['"]\}/, 'Expected projects tab selected state');
    assert.ok(dashboardSource.includes('aria-controls="epm-settings-projects-panel"'), 'Expected projects tab panel relationship');
    assert.ok(dashboardSource.includes('const handleEpmSettingsTabKeyDown = (event) => {'), 'Expected keyboard support for EPM sub-tabs');
    assert.ok(dashboardSource.includes('document.getElementById(`epm-settings-${tab}-tab`)'), 'Expected keyboard tab changes to preserve focus');
    assert.ok(dashboardSource.includes("epmSettingsTab === 'scope'"), 'Expected scope-only render branch');
    assert.ok(dashboardSource.includes("epmSettingsTab === 'projects'"), 'Expected projects-only render branch');
    assert.ok(dashboardSource.includes('Set sub-goal'), 'Expected prerequisite action for missing sub-goal');
    assert.ok(dashboardSource.includes('Set label prefix'), 'Expected prerequisite action for missing label prefix');
});
```

- [ ] **Step 2: Run the source guard and confirm it fails**

Run:

```bash
node --test tests/test_epm_settings_source_guards.js
```

Expected: FAIL because the EPM pane has no local sub-tabs.

- [ ] **Step 3: Add EPM tab state and prerequisite helpers**

Add state near the other EPM settings state declarations:

```js
const [epmSettingsTab, setEpmSettingsTab] = useState('scope');
```

Add prerequisite state near `hasDraftEpmScope`:

```js
const epmProjectPrerequisites = React.useMemo(() => getEpmProjectPrerequisites(epmConfigDraft), [epmConfigDraft]);
const canLoadEpmProjects = epmProjectPrerequisites.length === 0;
```

In `openEpmSettingsTab`, set the local tab:

```js
setEpmSettingsTab('scope');
```

Do not force the Projects tab back to Scope when prerequisites are missing. Projects remains clickable and renders a guided prerequisite panel.

Add this helper inside `Dashboard` near the other EPM settings helpers:

```js
const focusEpmScopeField = React.useCallback((field) => {
    setEpmSettingsTab('scope');
    window.requestAnimationFrame(() => {
        const selector = field === 'labelPrefix'
            ? '[data-epm-scope-field="labelPrefix"]'
            : '[data-epm-scope-field="subGoal"]';
        const node = document.querySelector(selector);
        if (node && typeof node.focus === 'function') {
            node.focus();
        }
    });
}, []);
```

- [ ] **Step 4: Split the EPM render branch**

Inside the current `{groupManageTab === 'epm' && (...)}` render branch, keep a single body and add an EPM-local tab strip at the top of the single pane. Cut the existing scope controls from the current EPM branch, starting at the `Atlassian site` subsection and ending after the `Label prefix` input, and place them inside the `epmSettingsTab === 'scope'` branch. Cut the existing project controls, starting at the `Add custom Project` button and ending after the final `No EPM projects found.` empty state, and place them inside the `epmSettingsTab === 'projects'` branch.

```jsx
{groupManageTab === 'epm' && (
<div className="group-modal-body group-projects-layout">
    <div className="group-pane group-single-pane">
        <div
            className="group-modal-tabs epm-settings-tabs"
            role="tablist"
            aria-label="EPM settings sections"
            onKeyDown={handleEpmSettingsTabKeyDown}
        >
            <button
                className={`group-modal-tab ${epmSettingsTab === 'scope' ? 'active' : ''}`}
                onClick={() => setEpmSettingsTab('scope')}
                role="tab"
                aria-selected={epmSettingsTab === 'scope'}
                aria-controls="epm-settings-scope-panel"
                id="epm-settings-scope-tab"
                type="button"
            >Scope</button>
            <button
                className={`group-modal-tab ${epmSettingsTab === 'projects' ? 'active' : ''}`}
                onClick={() => setEpmSettingsTab('projects')}
                role="tab"
                aria-selected={epmSettingsTab === 'projects'}
                aria-controls="epm-settings-projects-panel"
                id="epm-settings-projects-tab"
                type="button"
            >Projects</button>
        </div>
        {epmSettingsTab === 'scope' && (
            <div
                id="epm-settings-scope-panel"
                className="group-pane-list epm-settings-tab-panel"
                role="tabpanel"
                aria-labelledby="epm-settings-scope-tab"
            >
                <div className="group-pane-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <div className="group-pane-title">EPM scope</div>
                    <div className="group-pane-subtitle">Choose the Jira Home goal scope and label prefix used for EPM project mapping.</div>
                </div>
                {/* INSERT existing EPM scope JSX here:
                    - Atlassian site subsection
                    - Root goal picker
                    - Sub-goal selected chip/search input; add data-epm-scope-field="subGoal" to the input and selected chip remove button
                    - Label prefix input; add data-epm-scope-field="labelPrefix"
                   Cut this JSX from the current EPM settings branch, starting at the Atlassian site subsection and ending immediately after the Label prefix input. */}
            </div>
        )}
        {epmSettingsTab === 'projects' && (
            <div
                id="epm-settings-projects-panel"
                className="group-pane-list epm-settings-tab-panel epm-projects-tab-panel"
                role="tabpanel"
                aria-labelledby="epm-settings-projects-tab"
            >
                <div className="group-pane-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <div className="group-pane-title">EPM projects</div>
                    <div className="group-pane-subtitle">Map direct Jira Home projects under the selected sub-goal to exact Jira labels.</div>
                </div>
                {/* INSERT existing EPM project JSX here:
                    - Add custom Project button
                    - Loading/error/empty states
                    - epmSettingsProjectRows.map row renderer
                   Cut this JSX from the current EPM settings branch, starting at the Add custom Project button and ending after the final No EPM projects found empty state. */}
            </div>
        )}
    </div>
</div>
)}
```

When applying this step, do not keep a second copy of the existing EPM project rows in the Scope tab. The final EPM Scope branch contains only Atlassian site, Root goal, Sub-goal, and Label prefix. The final EPM Projects branch contains its own header, prerequisite state, Add custom Project, loading/error/empty states, and the `epmSettingsProjectRows.map` block.

Add `data-epm-scope-field="subGoal"` to the sub-goal input and selected chip remove button, and `data-epm-scope-field="labelPrefix"` to the label prefix input, so the prerequisite actions have stable focus targets.

- [ ] **Step 5: Add guided Projects prerequisite state**

At the top of the Projects panel, before any project loading state, render a compact prerequisite panel whenever `epmProjectPrerequisites.length > 0`:

```jsx
{epmProjectPrerequisites.length > 0 && (
    <div className="epm-prerequisite-panel">
        <div className="group-pane-title">Setup required</div>
        <div className="group-pane-subtitle">Choose the Jira Home sub-goal and label prefix before loading project configuration.</div>
        <div className="epm-prerequisite-actions">
            {epmProjectPrerequisites.includes('subGoal') && (
                <button className="secondary compact" type="button" onClick={() => focusEpmScopeField('subGoal')}>
                    Set sub-goal
                </button>
            )}
            {epmProjectPrerequisites.includes('labelPrefix') && (
                <button className="secondary compact" type="button" onClick={() => focusEpmScopeField('labelPrefix')}>
                    Set label prefix
                </button>
            )}
        </div>
    </div>
)}
```

This panel replaces any disabled-tab behavior. It must not clear existing project rows or sub-goal state.

- [ ] **Step 6: Add EPM sub-tab keyboard behavior**

Add a keyboard handler with Left/Right/Home/End support:

```js
const handleEpmSettingsTabKeyDown = (event) => {
    const tabs = ['scope', 'projects'];
    const focusTab = (tab) => {
        window.requestAnimationFrame(() => {
            const node = document.getElementById(`epm-settings-${tab}-tab`);
            if (node && typeof node.focus === 'function') {
                node.focus();
            }
        });
    };
    const currentIndex = tabs.indexOf(epmSettingsTab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
        const nextTab = tabs[nextIndex];
        setEpmSettingsTab(nextTab);
        focusTab(nextTab);
        return;
    }
    if (event.key === 'Home') {
        event.preventDefault();
        setEpmSettingsTab('scope');
        focusTab('scope');
        return;
    }
    if (event.key === 'End') {
        event.preventDefault();
        setEpmSettingsTab('projects');
        focusTab('projects');
    }
};
```

- [ ] **Step 7: Run source guard**

Run:

```bash
node --test tests/test_epm_settings_source_guards.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_epm_settings_source_guards.js
git commit -m "feat(epm): split project mapping into settings tab"
```

## Task 5A: Add Cached Project Configuration Loader

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/epm/epmFetch.js`
- Modify: `tests/test_epm_settings_source_guards.js`
- Modify: `tests/test_epm_shell_source_guards.js`

- [ ] **Step 1: Write source guards for automatic cached configuration loading**

In `tests/test_epm_settings_source_guards.js`, in the first source-guard test (`dashboard source includes the EPM settings tab and lazy-load flow`), delete the following preview-era assertions. Match by full assertion line, not by line number:

```js
assert.ok(dashboardSource.includes('const loadEpmConfig = async () => {'), 'Expected EPM config loader');
assert.ok(dashboardSource.includes('const loadEpmProjectPreview = async (draftConfig) => {'), 'Expected EPM draft preview loader');
assert.ok(dashboardSource.includes('if (hasSavedEpmScopeConfig(nextConfig)) {') && dashboardSource.includes('const nextProjects = await refreshEpmProjects();') && dashboardSource.includes('setEpmSettingsProjects(nextProjects);') && dashboardSource.includes('setEpmProjects([]);'), 'Expected save path to refresh only when saved scope exists and replace settings preview rows');
assert.ok(dashboardSource.includes('Run Test Configuration to preview projects for the selected draft scope.'), 'Expected explicit preview helper copy before settings preview runs');
assert.ok(dashboardSource.includes('void previewEpmProjectSettings().catch(() => {});'), 'Expected EPM Test Configuration button to drive draft preview');
assert.ok(dashboardSource.includes('setEpmSettingsProjects([]);') && dashboardSource.includes('setEpmSettingsProjectsError(\'\');'), 'Expected scope changes and settings load to clear stale preview rows');
```

If a `loadEpmConfig` declaration assertion is needed at all, replace it with one that matches the current non-async wrapper signature:

```js
assert.ok(dashboardSource.includes('const loadEpmConfig = () => fetchEpmConfig(BACKEND_URL);'), 'Expected EPM config loader wrapper');
```

The existing negative assertions in the second source-guard test (`!loadSettingsSource.includes('loadEpmProjectPreview(')` etc.) stay valid as long as the new symbols are absent. Do not weaken them.

After the deletions, add the following positive assertions to the first source-guard test (these cover the new auto-loader, snapshot-based fetch, header refresh, skeleton/error states, and save reconciliation):

```js
    assert.ok(dashboardSource.includes('const epmSettingsProjectsCacheRef = useRef(new Map());'), 'Expected settings project cache');
    assert.ok(dashboardSource.includes('const epmSettingsProjectsCacheKey = React.useMemo(() => getEpmSettingsProjectsCacheKey(epmConfigDraft), [epmConfigDraft]);'), 'Expected settings project cache key');
    assert.ok(dashboardSource.includes('const ensureEpmSettingsProjectsLoaded = async (options = {}) => {'), 'Expected automatic settings project loader');
    assert.ok(dashboardSource.includes("if (!showGroupManage || groupManageTab !== 'epm' || epmSettingsTab !== 'projects') return;"), 'Expected Projects tab scoped auto-load effect');
    assert.ok(dashboardSource.includes('void ensureEpmSettingsProjectsLoaded({'), 'Expected Projects tab to auto-load projects with a stable draft snapshot');
    assert.ok(dashboardSource.includes('draftConfig: draftSnapshot'), 'Expected Projects tab load to pass the draft snapshot');
    assert.ok(dashboardSource.includes('cacheKey: cacheKeySnapshot'), 'Expected Projects tab load to pass the matching cache key');
    assert.ok(!dashboardSource.includes('Run Test Configuration to preview projects for the selected draft scope.'), 'Project tab must not require manual preview before showing rows');
    assert.ok(!dashboardSource.includes("groupManageTab === 'epm' && epmSettingsTab === 'projects' && (\\n    <div className=\"group-modal-button-row\">"), 'EPM project refresh must not live in modal footer');
    assert.ok(dashboardSource.includes('className="epm-projects-header-actions"'), 'Expected Projects header actions for refresh/status');
    assert.ok(dashboardSource.includes('Refresh from Jira Home'), 'Expected Projects header refresh action');
    assert.ok(dashboardSource.includes('epmSettingsProjectsLoadedAt'), 'Expected cached/last-loaded status state');
    assert.ok(dashboardSource.includes('epmSettingsProjectsFetchMeta'), 'Expected Home project fetch metadata state');
    assert.ok(dashboardSource.includes('epmSettingsProjectsRefreshing'), 'Expected refresh state that preserves rows');
    assert.ok(dashboardSource.includes('missingFromHomeFetch'), 'Expected missing Home project reconciliation state');
    assert.ok(dashboardSource.includes('const getHomeBackedEpmSettingsProjects = (projects) => {'), 'Expected settings project cache to exclude custom rows rendered from config');
    assert.ok(dashboardSource.includes('epm-project-skeleton-row'), 'Expected skeleton loading rows');
    assert.ok(dashboardSource.includes('Retry'), 'Expected inline retry action for project load errors');
    assert.ok(!dashboardSource.includes('epmSettingsPreviewRequested'), 'EPM project configuration must not use preview-request state');
    assert.ok(!dashboardSource.includes('loadEpmProjectPreview'), 'EPM project configuration must not use preview-named loaders');
    assert.ok(dashboardSource.includes('const [epmSettingsProjectsLoaded, setEpmSettingsProjectsLoaded] = useState(false);'), 'Expected loaded-state for project configuration rows');
    assert.ok(dashboardSource.includes('const updateEpmSettingsProjectRowsAfterSave = (savedConfig) => {'), 'Expected save path to reconcile settings rows after custom id rekeying');
```

In `tests/test_epm_shell_source_guards.js`, replace the `fetchEpmProjectPreview` guard with a configuration-loader guard. The expected source should include:

```js
assert.ok(epmFetchSource.includes('export function fetchEpmConfigurationProjects(backendUrl, draftConfig, options = {}) {'), 'Expected EPM configuration project loader');
assert.ok(epmFetchSource.includes('const refreshParam = forceRefresh ? \'?refresh=true\' : \'\';'), 'Expected project configuration refresh query support');
assert.ok(epmFetchSource.includes('fetch(`${backendUrl}/api/epm/projects/configuration${refreshParam}`'), 'Expected configuration fetch endpoint');
assert.ok(!epmFetchSource.includes('/api/epm/projects/preview'), 'EPM settings must not call preview endpoint');
```

- [ ] **Step 2: Run source guards and confirm they fail**

Run:

```bash
node --test tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js
```

Expected: FAIL because project loading is manual and `epmFetch.js` still uses preview naming.

- [ ] **Step 3: Add configuration project loading to `epmFetch.js`**

Replace `fetchEpmProjectPreview` with:

```js
export function fetchEpmConfigurationProjects(backendUrl, draftConfig, options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    const refreshParam = forceRefresh ? '?refresh=true' : '';
    return fetch(`${backendUrl}/api/epm/projects/configuration${refreshParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftConfig || {}),
        cache: 'no-cache'
    }).then(response => json(response, 'EPM project configuration'));
}
```

Update the dashboard wrapper:

```js
const loadEpmConfigurationProjects = async (draftConfig, options = {}) => {
    return fetchEpmConfigurationProjects(BACKEND_URL, draftConfig, options);
};
```

- [ ] **Step 4: Add settings project cache state**

Add this ref near the settings project request ref:

```js
const epmSettingsProjectsCacheRef = useRef(new Map());
```

Add this memo near `canLoadEpmProjects`:

```js
const epmSettingsProjectsCacheKey = React.useMemo(() => getEpmSettingsProjectsCacheKey(epmConfigDraft), [epmConfigDraft]);
```

- [ ] **Step 5: Replace manual project test flow with cached automatic configuration loader**

Rename state:

```js
const [epmSettingsProjectsLoaded, setEpmSettingsProjectsLoaded] = useState(false);
const [epmSettingsProjectsLoadedAt, setEpmSettingsProjectsLoadedAt] = useState('');
const [epmSettingsProjectsFetchMeta, setEpmSettingsProjectsFetchMeta] = useState({
    cacheHit: false,
    fetchedAt: '',
    homeProjectCount: 0,
    homeProjectLimit: null,
    possiblyTruncated: false,
});
const [epmSettingsProjectsRefreshing, setEpmSettingsProjectsRefreshing] = useState(false);
```

Delete `epmSettingsPreviewRequested` and delete `previewEpmProjectSettings`.

Add this helper near `epmSettingsProjectRows`. The settings project state/cache stores Home-backed rows only; custom rows are rendered from `epmConfigDraft.projects`, which lets saved custom Project IDs rekey cleanly after `/api/epm/config` responds:

```js
const getHomeBackedEpmSettingsProjects = (projects) => {
    return Array.isArray(projects)
        ? projects.filter(project => project?.homeProjectId !== null)
        : [];
};
```

Add this function near the settings project loading helpers. It accepts a draft/cache-key snapshot so rapid label-prefix edits cannot cache a response under a newer key than the request body that produced it:

```js
const ensureEpmSettingsProjectsLoaded = async (options = {}) => {
    const forceRefresh = Boolean(options.forceRefresh);
    const draftConfig = normalizeEpmConfigDraft(options.draftConfig || epmConfigDraft);
    const cacheKey = options.cacheKey || getEpmSettingsProjectsCacheKey(draftConfig);
    if (!cacheKey) {
        setEpmSettingsProjectsError('');
        setEpmSettingsProjectsLoading(false);
        setEpmSettingsProjectsRefreshing(false);
        setEpmSettingsProjectsLoaded(false);
        setEpmSettingsProjectsLoadedAt('');
        return [];
    }
    if (!forceRefresh && epmSettingsProjectsCacheRef.current.has(cacheKey)) {
        const cachedEntry = epmSettingsProjectsCacheRef.current.get(cacheKey) || {};
        const cachedProjects = Array.isArray(cachedEntry.projects) ? cachedEntry.projects : [];
        const cachedLoadedAt = String(cachedEntry.loadedAt || '');
        setEpmSettingsProjects(cachedProjects);
        setEpmSettingsProjectsFetchMeta(cachedEntry.meta || {
            cacheHit: true,
            fetchedAt: '',
            homeProjectCount: cachedProjects.length,
            homeProjectLimit: null,
            possiblyTruncated: false,
        });
        setEpmSettingsProjectsError('');
        setEpmSettingsProjectsLoaded(true);
        setEpmSettingsProjectsLoadedAt(cachedLoadedAt);
        return cachedProjects;
    }

    epmSettingsProjectsRequestIdRef.current += 1;
    const requestId = epmSettingsProjectsRequestIdRef.current;
    const hasExistingRows = epmSettingsProjectsLoaded && epmSettingsProjectRows.length > 0;
    setEpmSettingsProjectsLoading(!hasExistingRows);
    setEpmSettingsProjectsRefreshing(hasExistingRows);
    setEpmSettingsProjectsError('');
    try {
        const payload = await loadEpmConfigurationProjects(draftConfig, { forceRefresh });
        if (epmSettingsProjectsRequestIdRef.current !== requestId) {
            return [];
        }
        const nextProjects = getHomeBackedEpmSettingsProjects(payload.projects);
        const nextMeta = {
            cacheHit: Boolean(payload.cacheHit),
            fetchedAt: String(payload.fetchedAt || ''),
            homeProjectCount: Number(payload.homeProjectCount || nextProjects.filter(project => project?.homeProjectId).length || 0),
            homeProjectLimit: payload.homeProjectLimit ?? null,
            possiblyTruncated: Boolean(payload.possiblyTruncated),
        };
        const loadedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        epmSettingsProjectsCacheRef.current.set(cacheKey, { projects: nextProjects, meta: nextMeta, loadedAt });
        setEpmSettingsProjects(nextProjects);
        setEpmSettingsProjectsFetchMeta(nextMeta);
        setEpmSettingsProjectsLoaded(true);
        setEpmSettingsProjectsLoadedAt(loadedAt);
        return nextProjects;
    } catch (err) {
        if (epmSettingsProjectsRequestIdRef.current !== requestId) {
            return [];
        }
        console.error('Failed to load EPM projects:', err);
        setEpmSettingsProjectsError(err?.message || 'Failed to load EPM projects.');
        return [];
    } finally {
        if (epmSettingsProjectsRequestIdRef.current === requestId) {
            setEpmSettingsProjectsLoading(false);
            setEpmSettingsProjectsRefreshing(false);
        }
    }
};
```

- [ ] **Step 6: Add Projects tab cache-key reset and auto-load effects**

Add this cache-key reset effect after the EPM settings load effect so `epmSettingsProjectsLoaded` cannot leak from a previous scope/key:

```js
useEffect(() => {
    if (epmSettingsProjectsCacheKey && epmSettingsProjectsCacheRef.current.has(epmSettingsProjectsCacheKey)) return;
    setEpmSettingsProjectsLoaded(false);
    setEpmSettingsProjectsLoadedAt('');
    setEpmSettingsProjectsFetchMeta({
        cacheHit: false,
        fetchedAt: '',
        homeProjectCount: 0,
        homeProjectLimit: null,
        possiblyTruncated: false,
    });
}, [epmSettingsProjectsCacheKey]);
```

Add this auto-load effect after the reset effect. It takes a stable draft snapshot and matching cache key before starting the request:

```js
useEffect(() => {
    if (!showGroupManage || groupManageTab !== 'epm' || epmSettingsTab !== 'projects') return;
    if (!canLoadEpmProjects || !epmSettingsProjectsCacheKey) return;
    const draftSnapshot = normalizeEpmConfigDraft(epmConfigDraft);
    const cacheKeySnapshot = getEpmSettingsProjectsCacheKey(draftSnapshot);
    if (!cacheKeySnapshot || cacheKeySnapshot !== epmSettingsProjectsCacheKey) return;
    void ensureEpmSettingsProjectsLoaded({
        draftConfig: draftSnapshot,
        cacheKey: cacheKeySnapshot,
    }).catch(() => {});
}, [showGroupManage, groupManageTab, epmSettingsTab, canLoadEpmProjects, epmSettingsProjectsCacheKey]);
```

## Task 5B: Render Project Configuration States and Save Reconciliation

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_epm_settings_source_guards.js`

- [ ] **Step 7: Move refresh/status into the Projects header**

Remove EPM project refresh/test controls from the modal footer. The footer stays modal-level only: Cancel and Save for EPM, and existing Test Configuration only for non-EPM settings tabs.

In the Projects panel header, render refresh and cache status next to the title:

```jsx
<div className="group-pane-header-row">
    <div>
        <div className="group-pane-title">EPM projects</div>
        <div className="group-pane-subtitle">Map direct Jira Home projects under the selected sub-goal to exact Jira labels.</div>
    </div>
    <div className="epm-projects-header-actions">
        {canLoadEpmProjects && (
            <span className="group-modal-meta" aria-live="polite">
                {epmSettingsProjectsRefreshing
                    ? 'Refreshing...'
                    : epmSettingsProjectsLoadedAt
                        ? `${epmSettingsProjectsFetchMeta.homeProjectCount} Home projects · fetched ${epmSettingsProjectsLoadedAt}${epmSettingsProjectsFetchMeta.cacheHit ? ' · cached' : ''}`
                        : 'Not loaded'}
                {epmSettingsProjectsFetchMeta.possiblyTruncated && epmSettingsProjectsFetchMeta.homeProjectLimit
                    ? ` · reached ${epmSettingsProjectsFetchMeta.homeProjectLimit} project limit`
                    : ''}
            </span>
        )}
        <button
            className="secondary compact"
            onClick={() => { void ensureEpmSettingsProjectsLoaded({ forceRefresh: true }).catch(() => {}); }}
            disabled={epmConfigLoading || epmConfigSaving || epmSettingsProjectsLoading || epmSettingsProjectsRefreshing || !canLoadEpmProjects}
            type="button"
        >
            {epmSettingsProjectsRefreshing ? 'Refreshing...' : 'Refresh from Jira Home'}
        </button>
    </div>
</div>
```

Keep the existing non-EPM Test Configuration footer path:

```jsx
{groupManageTab !== 'epm' && (
    <div className="group-modal-button-row">
        <button
            className="secondary compact"
            onClick={testGroupsConfigConnection}
            disabled={groupTesting}
            type="button"
        >
            {groupTesting ? 'Testing...' : 'Test configuration'}
        </button>
        {groupTestMessage && (
            <span className="group-modal-meta" aria-live="polite">{groupTestMessage}</span>
        )}
    </div>
)}
```

- [ ] **Step 8: Update Projects tab empty/loading copy**

In the Projects render branch, replace text-only states with polished states. Keep the current `epmSettingsProjectRows.map` row renderer inside the positive branch. The condition order must be:

1. `epmConfigLoading` renders three skeleton rows with `epm-project-skeleton-row`.
2. `epmProjectPrerequisites.length > 0` renders the prerequisite panel from Task 4.
3. `epmSettingsProjectsLoading && !epmSettingsProjectRows.length` renders skeleton rows.
4. `epmSettingsProjectsError && !epmSettingsProjectRows.length` renders an inline error panel with `Retry` and `Add custom Project`.
5. `epmSettingsProjectRows.length > 0` renders the existing project-row map. If `epmSettingsProjectsError` is also set, show a compact inline warning above the rows with `Retry`; do not clear the rows. If a row has `missingFromHomeFetch`, show a compact warning on that row: `Not returned by latest Jira Home refresh`.
6. `epmSettingsProjects.length === 0 && epmSettingsProjectsLoaded` renders an empty state with `Add custom Project`.
7. The final fallback renders skeleton rows only if a load is pending; otherwise no blank text-only panel.

Use this skeleton block:

```jsx
const renderEpmProjectSkeletonRows = () => (
    <div className="epm-project-skeleton-list" aria-label="Loading EPM projects">
        {[0, 1, 2].map((item) => (
            <div key={item} className="epm-project-skeleton-row">
                <span />
                <span />
            </div>
        ))}
    </div>
);
```

The refresh path must preserve existing rows while the header status changes to `Refreshing...`.

Update `epmSettingsProjectRows` so each row preserves the backend reconciliation flag:

```js
missingFromHomeFetch: Boolean(project?.missingFromHomeFetch),
```

Render the row warning close to the Project title:

```jsx
{project.missingFromHomeFetch && (
    <div className="group-field-helper epm-project-row-warning">
        Not returned by latest Jira Home refresh.
    </div>
)}
```

- [ ] **Step 9: Keep cache on scope-open and invalidate current rows on key changes**

Do not call `resetEpmSettingsProjectRows()` on settings open. On explicit root/sub-goal clear or a different root selection, continue to clear the visible settings rows by calling `resetEpmSettingsProjectRows()`, but leave `epmSettingsProjectsCacheRef.current` intact so returning to an old scope key can reuse cached projects.

When label prefix changes, clear label autocomplete results as it already does. Do not clear `subGoalKey`.

- [ ] **Step 10: Replace preview-era save behavior with settings-cache reconciliation**

In `saveEpmConfig`, delete writes to `epmSettingsPreviewRequested` and do not overwrite settings rows with `refreshEpmProjects()` output. Saving configuration should persist the normalized draft, let the saved config rekey custom project rows, refresh the main EPM view when saved scope exists, and keep the settings project-row cache aligned with the saved scope key.

Add this helper near the settings project loading helpers:

```js
const updateEpmSettingsProjectRowsAfterSave = (savedConfig) => {
    const previousCacheKey = getEpmSettingsProjectsCacheKey(epmConfigDraft);
    const nextCacheKey = getEpmSettingsProjectsCacheKey(savedConfig);
    if (!nextCacheKey) return;
    const rawPreviousEntry = previousCacheKey
        ? epmSettingsProjectsCacheRef.current.get(previousCacheKey)
        : null;
    const previousEntry = rawPreviousEntry
        ? {
            ...rawPreviousEntry,
            projects: getHomeBackedEpmSettingsProjects(rawPreviousEntry.projects),
        }
        : null;
    const currentEntry = epmSettingsProjects.length > 0
        ? {
            projects: getHomeBackedEpmSettingsProjects(epmSettingsProjects),
            meta: epmSettingsProjectsFetchMeta,
            loadedAt: epmSettingsProjectsLoadedAt,
        }
        : null;
    const nextEntry = previousEntry || currentEntry;
    if (nextEntry) {
        epmSettingsProjectsCacheRef.current.set(nextCacheKey, nextEntry);
    }
};
```

Replace the post-save success branch with:

```js
const payload = await response.json();
const nextConfig = normalizeEpmConfigDraft(payload);
setEpmConfigDraft(nextConfig);
epmConfigBaselineRef.current = JSON.stringify(nextConfig);
updateEpmSettingsProjectRowsAfterSave(nextConfig);
if (hasSavedEpmScopeConfig(nextConfig)) {
    await refreshEpmProjects();
} else {
    setEpmProjects([]);
    setEpmProjectsError('');
    setEpmSettingsProjects([]);
    setEpmSettingsProjectsLoaded(false);
}
```

This preserves Home-backed settings rows across save, handles custom Project id rekeying through `setEpmConfigDraft(nextConfig)`, renders custom rows from the normalized saved config, and avoids bringing main-view project payloads back into the draft settings cache.

- [ ] **Step 11: Run source guards**

Run:

```bash
rg -n "previewEpmProjectSettings|epmSettingsPreviewRequested|loadEpmProjectPreview" frontend/src/dashboard.jsx frontend/src/epm/epmFetch.js
```

Expected: no matches. `rg` exits 1 when no matches are found; that is the expected result for this check.

Then run:

```bash
node --test tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/src/epm/epmFetch.js tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js
git commit -m "feat(epm): auto-load cached settings projects"
```

## Task 6: Polish Layout, States, and Visual QA

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`
- Modify: `tests/test_dashboard_css_extraction.py`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/ui/epm_settings_visual_states.spec.js`

- [ ] **Step 1: Add Playwright test dependency**

Run:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Expected: `package.json` and `package-lock.json` include `@playwright/test` as a dev dependency, and Chromium is installed for the local Playwright runtime. Do not skip the dependency update if `tests/ui/epm_settings_visual_states.spec.js` is committed; the committed visual QA spec must be runnable from a clean checkout after `npm ci` plus `npx playwright install chromium`.

- [ ] **Step 2: Add CSS contract tests**

Append this test to `TestDashboardCssFileContract` in `tests/test_dashboard_css_extraction.py`:

```python
    def test_epm_settings_projects_layout_contract(self):
        css_path = Path(__file__).resolve().parents[1] / 'frontend' / 'dist' / 'dashboard.css'
        css = css_path.read_text(encoding='utf-8')
        self.assertIn('.epm-settings-tab-panel', css)
        self.assertIn('.epm-projects-tab-panel', css)
        self.assertIn('.epm-projects-scroll-region', css)
        self.assertIn('min-height: 0;', css)
        self.assertIn('overflow-y: auto;', css)
        self.assertIn('.epm-projects-header-actions', css)
        self.assertIn('.epm-prerequisite-panel', css)
        self.assertIn('.epm-project-skeleton-row', css)
        self.assertIn('.epm-project-load-error', css)
        self.assertIn('.epm-project-row-warning', css)
        self.assertIn('.epm-label-menu-layer', css)
```

- [ ] **Step 3: Run the CSS contract test and confirm it fails**

Run:

```bash
python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssFileContract.test_epm_settings_projects_layout_contract
```

Expected: FAIL because the EPM-specific layout classes do not exist yet.

- [ ] **Step 4: Add explicit scroll and state styling**

Add these classes to `frontend/dist/dashboard.css` near the existing group modal styles:

```css
.epm-settings-tabs {
    flex-shrink: 0;
}

.epm-settings-tab-panel {
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    flex: 1;
}

.epm-projects-tab-panel {
    min-height: 0;
}

.epm-projects-scroll-region {
    min-height: 0;
    overflow-y: auto;
    overflow-x: visible;
    flex: 1;
    padding: 0.6rem 0.6rem 0.8rem;
}

.epm-projects-header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.epm-prerequisite-panel,
.epm-project-load-error,
.epm-project-empty-state {
    border: 1px solid var(--border);
    background: #fff;
    border-radius: 8px;
    padding: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
}

.epm-prerequisite-actions,
.epm-project-state-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.epm-project-skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.epm-project-skeleton-row {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    padding: 0.75rem;
    display: grid;
    grid-template-columns: minmax(8rem, 1fr) minmax(10rem, 1.4fr);
    gap: 0.75rem;
}

.epm-project-skeleton-row span {
    display: block;
    height: 0.75rem;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(148,163,184,0.18), rgba(148,163,184,0.32), rgba(148,163,184,0.18));
}

.epm-label-menu-layer {
    position: fixed;
    z-index: 10000;
    max-height: min(280px, calc(100vh - 24px));
    overflow-y: auto;
}

.epm-project-row-warning {
    color: #92400e;
}
```

Layout contract:

- The modal footer remains outside the scroll region.
- `epm-projects-scroll-region` is the only vertical scroller for project rows.
- The body and panels use `min-height: 0` so flex children can shrink.
- Project label autocomplete renders in `.epm-label-menu-layer` using fixed positioning from the focused input's `getBoundingClientRect()`, so it is not clipped by the scrolling list or modal footer.

- [ ] **Step 5: Add fixed-position label autocomplete layer**

In `frontend/src/dashboard.jsx`, render EPM label search results into a dedicated fixed layer instead of inside the row scroll container. Keep existing row label behavior, but move only the results list.

Add state:

```js
const [epmLabelMenuAnchor, setEpmLabelMenuAnchor] = useState(null);
const epmLabelMenuInputRef = useRef(null);
```

On label input focus, set the anchor:

```js
const openEpmLabelMenu = (projectId, inputNode, showAllLabels) => {
    const rowKey = getEpmLabelRowKey(projectId);
    const rect = inputNode.getBoundingClientRect();
    epmLabelMenuInputRef.current = inputNode;
    setEpmLabelMenuAnchor({
        projectId,
        rowKey,
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
    });
    setLabelSearchOpen(prev => ({ ...prev, [rowKey]: true }));
    void loadEpmProjectLabels(projectId, showAllLabels);
};
```

Keep the fixed menu aligned while the Projects list scrolls or the viewport changes:

```js
useEffect(() => {
    if (!epmLabelMenuAnchor) return;
    const reposition = () => {
        const inputNode = epmLabelMenuInputRef.current;
        if (!inputNode || !document.body.contains(inputNode)) {
            setEpmLabelMenuAnchor(null);
            epmLabelMenuInputRef.current = null;
            return;
        }
        const rect = inputNode.getBoundingClientRect();
        setEpmLabelMenuAnchor(prev => prev ? {
            ...prev,
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
        } : prev);
    };
    const scrollRegion = document.querySelector('.epm-projects-scroll-region');
    window.addEventListener('resize', reposition);
    scrollRegion?.addEventListener('scroll', reposition, { passive: true });
    return () => {
        window.removeEventListener('resize', reposition);
        scrollRegion?.removeEventListener('scroll', reposition);
    };
}, [epmLabelMenuAnchor?.rowKey]);
```

Render the floating results once near the modal root:

```jsx
{epmLabelMenuAnchor && labelSearchOpen[epmLabelMenuAnchor.rowKey] && (
    <div
        className="team-search-results epm-label-menu-layer"
        style={{
            top: epmLabelMenuAnchor.top,
            left: epmLabelMenuAnchor.left,
            width: epmLabelMenuAnchor.width,
        }}
        onMouseDown={(event) => event.preventDefault()}
    >
        {getEpmLabelSearchResults(epmLabelMenuAnchor.projectId).length === 0 ? (
            <div className="team-search-result-item is-empty">
                {labelSearchLoading[epmLabelMenuAnchor.rowKey] ? 'Searching labels...' : 'No labels found'}
            </div>
        ) : getEpmLabelSearchResults(epmLabelMenuAnchor.projectId).map((label, index) => (
            <div
                key={`${epmLabelMenuAnchor.rowKey}-${label}`}
                className={`team-search-result-item ${(labelSearchIndex[epmLabelMenuAnchor.rowKey] || 0) === index ? 'active' : ''}`}
                onMouseEnter={() => setLabelSearchIndex(prev => ({ ...prev, [epmLabelMenuAnchor.rowKey]: index }))}
                onClick={() => selectEpmProjectLabel(epmLabelMenuAnchor.projectId, label)}
            >
                {label}
            </div>
        ))}
    </div>
)}
```

When closing a row menu, also call `setEpmLabelMenuAnchor(null)` and `epmLabelMenuInputRef.current = null`.

- [ ] **Step 6: Create visual QA Playwright spec**

Create `tests/ui/epm_settings_visual_states.spec.js` with this committed screenshot matrix. It uses mocked endpoints with synthetic data only. The spec must be hermetic: register a catch-all `/api/**` mock before the specific EPM mocks so unrelated dashboard startup requests cannot hit real Jira-backed endpoints during visual QA.

```js
const { test, expect } = require('@playwright/test');

const viewports = [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
];

const epmConfig = {
    version: 2,
    labelPrefix: 'rnd_project_',
    scope: { rootGoalKey: 'CRITE-223', subGoalKey: 'CRITE-34' },
    projects: {
        'home-1': { id: 'home-1', homeProjectId: 'home-1', name: 'BidSwitch', label: 'rnd_project_bidswitch' },
    },
};

const homeProjects = Array.from({ length: 18 }, (_, index) => ({
    id: `home-${index + 1}`,
    homeProjectId: `home-${index + 1}`,
    name: `Synthetic Project ${index + 1}`,
    homeUrl: '',
    stateValue: 'ON_TRACK',
    stateLabel: 'On track',
    tabBucket: 'active',
    latestUpdateDate: '2026-04-27',
    latestUpdateSnippet: 'Synthetic update',
    label: index === 0 ? 'rnd_project_bidswitch' : '',
    resolvedLinkage: { labels: index === 0 ? ['rnd_project_bidswitch'] : [], epicKeys: [] },
    matchState: index === 0 ? 'jep-fallback' : 'metadata-only',
}));

async function mockSettings(page, overrides = {}) {
    await page.route('**/api/**', route => {
        const url = route.request().url();
        const handledBySpecificMock = [
            '/api/epm/config',
            '/api/epm/scope',
            '/api/epm/goals',
            '/api/epm/projects/configuration',
            '/api/jira/labels',
        ].some(path => url.includes(path));
        if (handledBySpecificMock) {
            return route.fallback();
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({}),
        });
    });
    await page.route('**/api/epm/config', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...epmConfig, ...(overrides.config || {}) }),
    }));
    await page.route('**/api/epm/scope', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cloudId: 'synthetic-cloud', error: '' }),
    }));
    await page.route('**/api/epm/goals**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            goals: [
                { id: 'root', key: 'CRITE-223', name: '[EPM] R&D bi weekly report hierarchy' },
                { id: 'child', key: 'CRITE-34', name: '[EPM] BidSwitch' },
            ],
            error: '',
        }),
    }));
    await page.route('**/api/epm/projects/configuration**', route => {
        if (overrides.projectError) {
            return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic failure' }) });
        }
        if (overrides.projectDelay) {
            setTimeout(() => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ projects: overrides.projects || homeProjects }),
            }), overrides.projectDelay);
            return;
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ projects: overrides.projects || homeProjects }),
        });
    });
    await page.route('**/api/jira/labels**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ labels: ['rnd_project_bidswitch', 'rnd_project_long_label_for_visual_qa'] }),
    }));
}

async function openEpmSettings(page) {
    await page.goto('http://127.0.0.1:5050');
    await page.getByRole('button', { name: /settings/i }).click();
    await page.getByRole('button', { name: 'EPM' }).click();
}

for (const viewport of viewports) {
    test.describe(`EPM settings visual states ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('scope loaded', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await expect(page.getByRole('tab', { name: 'Scope' })).toHaveAttribute('aria-selected', 'true');
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-scope-loaded.png`, fullPage: true });
        });

        test('projects prerequisites', async ({ page }) => {
            await mockSettings(page, { config: { scope: { rootGoalKey: 'CRITE-223', subGoalKey: '' }, labelPrefix: '' } });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.getByText('Setup required')).toBeVisible();
            await expect(page.getByRole('button', { name: 'Set sub-goal' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Set label prefix' })).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-prerequisites.png`, fullPage: true });
        });

        test('projects loading skeleton', async ({ page }) => {
            await mockSettings(page, { projectDelay: 800 });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.locator('.epm-project-skeleton-row').first()).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-loading.png`, fullPage: true });
        });

        test('projects many rows and long labels', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.getByText('Synthetic Project 18')).toBeVisible();
            await expect(page.getByText('No Jira label selected.').first()).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-many-rows.png`, fullPage: true });
        });

        test('projects scrolled label menu stays aligned', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            const scrollRegion = page.locator('.epm-projects-scroll-region');
            await expect(scrollRegion).toBeVisible();
            await scrollRegion.evaluate(node => { node.scrollTop = node.scrollHeight; });
            await page.getByPlaceholder('Search Jira labels...').last().click();
            await expect(page.locator('.epm-label-menu-layer')).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-scrolled-label-menu.png`, fullPage: true });
        });

        test('projects error state', async ({ page }) => {
            await mockSettings(page, { projectError: true });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-error.png`, fullPage: true });
        });
    });
}
```

- [ ] **Step 7: Run CSS contract and source guards**

Run:

```bash
python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssFileContract.test_epm_settings_projects_layout_contract
node --test tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.css tests/test_dashboard_css_extraction.py tests/ui/epm_settings_visual_states.spec.js package.json package-lock.json
git commit -m "test(epm): add settings projects visual QA"
```

## Task 7: Build, Test, and Visually Verify the Settings Flow

**Files:**
- Generated by build: `frontend/dist/dashboard.js`
- Generated by build: `frontend/dist/dashboard.js.map`

- [ ] **Step 1: Build the frontend**

Run:

```bash
npm run build
```

Expected: esbuild completes and updates `frontend/dist/dashboard.js` plus `frontend/dist/dashboard.js.map`.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
node --test tests/test_epm_project_utils.js tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: PASS.

- [ ] **Step 3: Run focused backend tests**

Run:

```bash
python3 -m unittest tests.test_epm_config_api tests.test_epm_projects_api tests.test_epm_rollup_api tests.test_epm_issues_endpoint
```

Expected: PASS.

- [ ] **Step 4: Run full tests before merge or push**

Run:

```bash
python3 -m unittest discover -s tests
```

Expected: PASS.

- [ ] **Step 5: Run the local server**

Run:

```bash
python3 jira_server.py
```

Expected: server starts on `http://127.0.0.1:5050`.

- [ ] **Step 6: Run visual QA screenshot matrix**

Run:

```bash
mkdir -p /tmp/epm-settings-qa
npx playwright install chromium
npx playwright test tests/ui/epm_settings_visual_states.spec.js
```

Expected: PASS and screenshots written under `/tmp/epm-settings-qa` for desktop and mobile Scope loaded, Projects prerequisite state, Projects loading skeleton, Projects many rows/missing labels, Projects scrolled label menu, and Projects error state. Inspect every screenshot before continuing.

- [ ] **Step 7: Browser verification**

Use the in-app browser or Playwright against `http://127.0.0.1:5050` and verify:

- Open `Dashboard Settings -> EPM`.
- Scope sub-tab opens with saved Root goal, saved Sub-goal, and Label prefix visible.
- Sub-goal chip renders immediately from saved config without a `Loading sub-goals...` spinner.
- Projects sub-tab is always clickable.
- Projects shows a compact prerequisite panel when either Sub-goal or Label prefix is empty, with `Set sub-goal` and `Set label prefix` actions that return focus to Scope.
- Opening Projects auto-loads Jira Home projects once for that cache key.
- Closing and reopening settings does not refetch sub-goals.
- Returning to Projects for the same scope uses cached project rows.
- `Refresh from Jira Home` is in the Projects header and forces a new project fetch without blanking existing rows.
- Project rows scroll inside the Projects sub-tab and do not sit underneath the modal footer.
- Label autocomplete menus render above the scroll region/footer, stay aligned after scrolling the project list, and are not clipped.
- Save persists project label mapping and does not clear the Home project cache for the same scope.
- Active EPM rollup requests use the configured project label and selected sprint value; they do not use Jira team or team-group filters.

Capture screenshots for:

- Desktop and mobile Scope sub-tab with selected Root/Sub-goal/Prefix.
- Desktop and mobile Projects prerequisite state.
- Desktop and mobile Projects loading skeleton.
- Desktop and mobile Projects with many rows, long/missing labels, header refresh/status, and footer visible.
- Desktop and mobile Projects with the list scrolled and a lower-row label autocomplete menu open.
- Desktop and mobile Projects error state with inline Retry.

- [ ] **Step 8: Commit generated bundle**

```bash
git add frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "build(epm): update settings project bundle"
```

## Quality Bar

- No Jira Home sub-goal fetch on settings open just to render the saved sub-goal.
- No project mapping rows in the Scope sub-tab.
- Projects tab is always clickable; missing prerequisites are shown inside the Projects panel with direct Scope actions.
- No manual test/preview required before Projects can load.
- `Refresh from Jira Home` is in the Projects header with cached/last-loaded status, not in the modal footer.
- Loading uses skeleton rows; refresh preserves existing rows; errors show inline Retry; empty state offers Add custom Project.
- EPM sub-tabs have `tablist`/`tab`/`tabpanel` semantics, selected state, keyboard navigation, and stable focus.
- No clearing `subGoalKey` except explicit clear or actual root-goal change.
- No backend project cache invalidation on label-only EPM config saves.
- No stale labels from cached project payloads; labels are shaped from the latest config.
- No Jira team or team-group filter in EPM project configuration or EPM rollup JQL.
- No rows hidden behind the modal footer in the Projects sub-tab.
- Desktop and mobile visual QA screenshots cover Scope, prerequisites, loading, many rows, long/missing labels, scrolled label menu alignment, and error states.
- Full test suite passes before merge or push.
