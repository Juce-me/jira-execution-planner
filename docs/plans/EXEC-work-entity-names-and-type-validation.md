# Work entity names and Jira type validation implementation plan

> **Status:** Planned, not started. Follow-up to [Quarterly work-structure migration](EXEC-quarterly-work-structure-migration.md) on branch `feature/quarterly-project-configurations`. Decisions D1–D3 accepted by the owner on 2026-11-03 with the recommended defaults (D1a, D2a, D3a); revision 3 applies two review rounds (see Review log).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ENG surface names, counts, draws and reports each row by the Jira issue type the administrator selected for its role in Settings → Project config → Field mapping, and the server reports new-model work whose Jira hierarchy links do not match that selection instead of hiding it silently.

**Architecture:** The server captures `{id, name, hierarchyLevel}` for each selected role type on every Save (first and later) and stores it server-owned beside the bundle; dashboard summaries carry it as `roleTypes`. The full Catch Up tasks response adds the planning/parent names it observed (rows there are already filtered by the configured ids) and new-model link-mismatch counts. One frontend module turns `(model, roleTypes, observed)` into an `EntityNames` object built in App and passed as explicit props; icons and analytics kinds come from each row's role, never from a display name. No new Jira request on initial load.

**Tech Stack:** Flask/Python, React 19 + esbuild (Node 20), `unittest`, `node --test` unit tests, Playwright (Chromium).

**Spec:** the owner's 2026-11-03 request (DELIVERY Catch Up shows "5 STORIES · 1 REQUIRED", "1 Epics required", a "Story required" card, Story icons on Epic rows; validate types with Jira; check analytics; names must follow what the admin selected) and the role table in [EXEC-quarterly-work-structure-migration](EXEC-quarterly-work-structure-migration.md).

## Verified facts this plan relies on

- Saved hierarchy is ids only (local DB probe, ids only): DELIVERY planning `6`, parent `11700`, ancestor `12723`, optional ancestor `13756`/`14560` in two workspaces; Legacy `legacyIssueTypeNames: ["Story"]`, `legacyDisplayTypes.ancestor` captured, `parent` null.
- `workEntityNames(model)` (`frontend/src/eng/engWorkModel.js:14`) and wrappers `reviewLabels(workModel)` (`eng/planningReviewKinds.js:20`, also derives `parentColumnId`; called with no argument at `PlanningReviewTable.jsx:63`), `roleLabels` / `describeStatsScope(workContext, summaries)` (`stats/statsScope.js:7-26`) return fixed words per model. Other callers: `engWorkHierarchy.js:41,55,64` (readiness copy, fed from `dashboard.jsx:4438`), `engCatchUpFilters.js` (`buildEngCatchUpFacetModel` :120, `resolveEngCatchUpFilters` :207/:248), `engBoardFilters.js:185`, `useEngAlerts.js:31`, `scenarioUtils.js:188`, `ScenarioView.jsx:15`, `planningReviewTableModel.js:68,162`, `TeamGroupsSettings.jsx:101`. Only the Settings preview reads catalog names (`settings/workConfigurationFormProps.js:210-245`).
- Rows already match their role by construction: planning rows are queried with `issuetype = <planningIssueTypeId>` (`planning_work.py:207-210`); a child groups under a parent only when `parent_ref_matches` accepts the parent's type, a permission-reduced parent without type is accepted in the new model (`planning_work.py:304-326`); an ancestor is attached only on exact id match (`jira_server.py:3050-3063`), otherwise dropped; the readiness `initiative` slot takes any parent with a summary, unchecked (`backend/routes/eng_routes.py:540-545`); readiness already requests `parent` (`:520-521`), which carries the parent's issue type.
- Every row shaper trims `issuetype` to `{name}` (`jira_server.py:3978,6190`, `eng_routes.py:1647,1906`, `eng_board.py:866,1068`); the cached tasks `data` holds those trimmed rows; `epics` carry only `initiative`.
- Save prefetches `/rest/api/3/issuetype` only before promotion (`work_structure_routes.py:580-582`); `_save_later` returns `None` when no entry changed (`work_structure.py:977-978`) and any write bumps the global `config_revision` with an audit row (`workspace_dashboard_config.py:278-283,316-325`); `_normalize_entry` rejects unknown keys (`work_structure.py:244-246,356-361`); `_entry_digest` excludes only `name` (`:602-605`); readiness caches key on the whole payload plus `configRevision` (`eng_routes.py:253-254,270-271`), retired on save (`work_structure_routes.py:594`).
- `/api/config` strips the moved keys, `workConfigurations` and `epm` (`settings_routes.py:1264-1267,1283`) and returns the rest as `sharedConfig` (`:1362`); summaries only for promoted workspaces (`:1312-1318`).
- Frontend: `IssueCard` does not read `IssueCardContext` (`issues/IssueCard.jsx:12`); ENG cards get explicit props from `EpicBlock.jsx:348-365`; EPM reads the context (`epm/EpmRollupPanel.jsx:32,516-529`); `IssueCard` without props also renders at `EngView.jsx:178` and `PlanningReviewTable.jsx:403`. Tasks responses are locals in `useEngSprintData.js:181-190` (Product and Tech lanes are separate requests, `:168-235`), which has no own state. `buildCatchUpStatusTargets(issue, fallbackIssueType)` takes the kind from the Jira name (`engStatusTransitionUtils.js:71-80`), and `fallbackIssueType` feeds `data-issue-kind` (`StatusTransitionMenu.jsx:191`) and the priority cache key (`engPriorityTransitionUtils.js:23,57`).
- "1 Epics required": the pill count is a separate span (`EngAlertsPanel.jsx:210-211`) and the label is always `names.childPlural` (`:167`); the pin note uses the raw constant (`:115`). Legacy shows "1 Stories required" the same way.
- Budgets: `dashboard.jsx` is at its exact `lineCeiling` 7496 and `hookCeilings.useState` 121 (`scripts/extraction_lint/owner_budgets.json:21-27`); the regrowth guard counts only the seven built-in hooks (`tests/test_dashboard_regrowth_guard.js:11,24`). `EpicBlock.jsx`, `StatsPanel.jsx`, `workConfigurationModel.js`, `workConfigurationFormProps.js` are registered; `useEngSprintData.js` is not; `jira_server.py` 7506/8210.

## Decisions

- **D1a (accepted).** Names are captured on every Save and refreshed by observation: the full Catch Up tasks response reports the names Jira returned for the planning and parent role ids; for the same configuration digest an observed name wins over the capture. Board, Statistics and quarters with nothing loaded use the capture. No extra request on first load.
- **D2a (accepted).** Analytics `issue_kind` gains `objective`; kinds derive from role + configured hierarchy level, never from the display name.
- **D3a (accepted, clarified).** Icons are the existing SVGs chosen by hierarchy level — 0 bookmark, 1 bolt, ≥2 `InitiativeIcon` — with the Jira type name as title/aria. Every rendered row is of its role's configured type, so the level is the role's configured level from `roleTypes`; no per-row type id is added to payloads.

## Global Constraints

- **Name source.** User-visible entity words on in-scope surfaces come only from `EntityNames` (Task 2). Settings' empty-slot labels (`hierarchyLabels`, `workConfigurationModel.js:69`) stay model-based; `TeamGroupsSettings.jsx:101` is out of scope (Settings copy about Department Teams, not a work row) and stays on the model default.
- **Delivery path.** `EntityNames` reaches React surfaces as an explicit `entityNames` prop (App → `epicBlockProps` → `EpicBlock` → `IssueCard`; App → `EngAlertsPanel`, `PlanningReviewTable`, Board, Stats, Scenario, `EngView` and both readingDeparture `IssueCard`s). Plain modules take `names` instead of `workModel`. `IssueCardContext` is not used; `EpmRollupPanel` passes no `entityNames`, so EPM keeps today's defaults (guarantee, tested).
- **Tokens are not names.** `issueKind`, `issue_type_mix`, `rowKind`, `fallbackIssueType`, `data-issue-kind`, onboarding step ids/targets, share-link `kind` (`ShareViewButton.jsx:90`), export kinds (`dashboard.jsx:4401,4405`), section ids and CSS classes stay fixed tokens derived from role/`*Kind`; never from a Jira name.
- **Counts.** `formatEntityCount(count, names, role)`: `1` → singular, any other number → plural, in every configuration including Legacy (fixes "1 Stories required" too). Legacy test pins that change are listed in Task 4/6 and change deliberately.
- **Plural rule** (`pluralizeEntityName`): all-caps or ending in a non-letter → `+s` (`OKR`→`OKRs`, `Q&A`→`Q&As`); consonant+`y` → `ies`; `s|x|z|ch|sh` → `es`; else `+s`.
- **Case.** `lowerEntityWord(word)` lowercases unless the word contains two consecutive capitals. Title attributes use `name.toUpperCase()`; visible uppercase stays CSS.
- **Fallbacks.** Missing capture, unpromoted workspace or catalog failure → model defaults: Legacy Story/Epic/Initiative (levels 0/1/2), new model Epic/Initiative/Objective/Strategy (levels 1/2/3/4). Levels are used only if they strictly increase child < parent < ancestor; otherwise every level falls back to the model defaults. A role never resolves to `unknown`.
- **Legacy name rule.** Planning: `legacyIssueTypeNames` with exactly one name → that name; `null` → catalog name of `hierarchy.planningIssueTypeId`; `[]` or several → `Story`. Parent/ancestor: `mapped` mode → catalog name by id; `compatibility` → `Epic`/`Initiative`. Today's stored Legacy (`["Story"]`, compatibility) keeps every word.
- **Storage.** Captured types live at payload key `workConfigurationTypeNames: {<configurationId>: {planning, parent, ancestor, optionalAncestor}}`, each `null` or `{"id": "6", "name": "Epic", "hierarchyLevel": 1}`; name ≤ 255 chars (the catalog limit, `settings_routes.py:487`). It is outside the bundle, never in an editor envelope or `sharedConfig` (popped at `settings_routes.py:1265`), not in any digest or `_compare_entry`; other dashboard-config writers preserve it (they copy the whole payload). The readiness cache already keys on the whole payload; that is harmless because saves retire it. A slot keeps its previous capture only while its id is unchanged; a changed id with a failed prefetch stores `null`.
- **Write path.** `_save_first` and `_save_later` resolve names in the fence from the prefetched map against the final saved ids. When no entry changed and the resolved names equal the stored ones, Save stays a no-op. When only names differ, it writes them without bumping any entry `revision`, accepting the global `configRevision` bump and audit row, and returns `changedConfigurationIds: []`.
- **Jira I/O.** The catalog read (existing 10 s timeout) stays outside the fence; an `AuthError` keeps today's 401; any other failure saves without names.
- **Mismatch reporting** is new-model only (Legacy and unpromoted unchanged, no notice); permission-reduced links without type are unknown and not counted; with no ancestor type configured, ancestor links are not checked. It never drops a readable row; payloads carry counts and at most 20 issue keys.
- **Analytics.** No new event; `issue_kind`/`issue_type_mix` already registered (`docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml:64,142-143`).
- **Budgets.** Each task that edits a registered file runs `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` and `node --test tests/test_dashboard_regrowth_guard.js` and re-stamps that file's `sourceDigest` in the same commit. `dashboard.jsx` adds no built-in hook; its `lineCeiling` may be raised in Task 2, 4 or 6 by exactly that task's net growth, with the reason "entity names passed to existing surfaces" in the commit body (AGENTS.md section 11 permits raising only that file's ceiling).
- **Live data** read-only and transient: ids/counts only, no saved screenshots.
- **Commits:** local only, identity `-c user.name=Juce -c user.email=Juce-me@users.noreply.github.com`, no attribution trailers, no push.

## Review Focus

1. Jira renames the planning type after Save: Catch Up and Planning show the new name on the next full tasks load (observed wins for the same digest); Board shows it after the next Save. Tests: Task 3 (`observed`), Task 2 (precedence).
2. Irregular names (`Capability`, `Process`, `OKR`, `Q&A`): `1 Capability`, `2 Capabilities`, `2 Processes`, `2 OKRs`, `2 Q&As`; readouts keep `OKR` capitalised. Task 2.
3. A DELIVERY Epic whose Jira parent is not the configured parent type (renders ungrouped) and an Initiative whose parent is not the ancestor type (ancestor dropped): counted, noticed, rows unchanged; a permission-reduced parent is not counted; Legacy shows no notice. Task 3.
4. Pre-change bundle / unpromoted workspace / empty quarter / non-increasing levels: model-default names and kinds, never blank or `unknown`. Tasks 1 and 2.
5. A Save after a Jira rename with no bundle change: names refresh without bumping any entry revision; an echo of an older editor envelope saves normally. Task 1.

---

### Task 0: Type check of the configured roles (read-only, before code)

**Files:** none committed; ids/counts recorded in Outcome.

- [ ] **Step 1:** With the user signed in at `http://localhost:5050/` (DELIVERY quarter `2027Q1`), read `GET /api/issue-types?configurationId=delivery&configurationRevision=<rev>` in the browser console; for each configured id record whether it is present in `issueTypes[]` and its `hierarchyLevel`. Expected: `6` level 1, `11700` level 2, `12723` level 3, optional ancestor level 4. A missing id or wrong level is a configuration defect to report before Task 3.
- [ ] **Step 2:** After Task 3, read `workTypes.linkMismatches` counts from the `2027Q1` tasks response (numbers only) and record them.

### Task 1: Capture role types on every Save; expose `roleTypes`

**Files:**
- Modify: `backend/services/work_structure.py` (new `capture_role_types(entries, catalog_map, previous) -> dict`; `entry_summary(entry, entries=None, role_types=None)`; `_save_first`/`_save_later` names-only write per Global Constraints)
- Modify: `backend/routes/work_structure_routes.py` (`_prefetch_issue_type_catalog(auth_context) -> dict | None` mapping `id -> {"name", "hierarchyLevel"}`, run on every save; first-save `legacyDisplayTypes` derived from it exactly as today)
- Modify: `backend/routes/settings_routes.py:1265` (pop `workConfigurationTypeNames`), `:1318` (pass `role_types`)
- Modify: `backend/security/CONFIGURATION_OWNERSHIP.md:152` (`roleTypes`, server-owned key)
- Test: `tests/test_work_structure.py`, `tests/test_work_structure_storage.py`, `tests/test_work_structure_routes.py`, `tests/test_work_structure_cache_identity.py`

**Interfaces:**
- Produces: summary `roleTypes: {planning, parent, ancestor, optionalAncestor}` for promoted workspaces; Legacy slots per the Legacy name rule (`compatibility` → `{"id": null, "name": "Epic"|"Initiative", "hierarchyLevel": 1|2}`).

- [ ] **Step 1: Failing tests**
  - `test_work_structure.py`: `test_capture_role_types_for_delivery` (catalog `{'6':{'name':'Epic','hierarchyLevel':1},'11700':{'name':'Initiative','hierarchyLevel':2},'12723':{'name':'Objective','hierarchyLevel':3}}` → planning `{'id':'6','name':'Epic','hierarchyLevel':1}`, optionalAncestor `None`); `test_capture_keeps_previous_only_for_unchanged_ids`; `test_legacy_role_types_follow_legacy_name_rule` (`["Story"]`→Story, `["Task"]`→Task, `[]`/`["Story","Bug"]`→Story, `None`+catalog id→its name, compatibility parent→Epic); extend `:269` for `role_types`.
  - `test_work_structure_cache_identity.py::test_role_type_names_are_outside_every_digest` (payloads differing only in `workConfigurationTypeNames` → equal `effective_digest`, context digest, `work_configuration_cache_segment`).
  - `test_work_structure_storage.py`: `test_first_save_captures_type_names`; `test_save_after_promotion_refreshes_type_names`; `test_names_only_change_keeps_entry_revisions` (entry revisions equal, `changedConfigurationIds == []`); `test_unchanged_names_and_bundle_is_a_no_op`; `test_other_dashboard_config_writes_preserve_type_names`.
  - `test_work_structure_routes.py`: `test_type_names_are_absent_from_shared_config_and_editor_envelope` (extend `:667-668`); update the exact summary key set at `:670` to include `roleTypes` (deliberate); `test_prefetch_failure_still_saves`; unpromoted bootstrap keeps `workConfigurationSummaries == []`.
- [ ] **Step 2:** `.venv/bin/python -m unittest tests.test_work_structure tests.test_work_structure_storage tests.test_work_structure_routes tests.test_work_structure_cache_identity` → new cases fail.
- [ ] **Step 3:** Implement; `hierarchyLevel` accepted only as non-bool int.
- [ ] **Step 4:** Re-run those modules plus `tests.test_codebase_structure_budgets`, `tests.test_work_structure_scenario_denial` → pass.
- [ ] **Step 5:** Commit `Capture configured Jira type names on every Settings save`.

### Task 2: `EntityNames` resolver and its App source

**Files:**
- Modify: `frontend/src/eng/engWorkModel.js` (resolver and helpers; `workEntityNames(model)` remains a default-only wrapper until Tasks 4/6 migrate its callers, then is removed if unused)
- Create: `frontend/src/eng/useWorkEntityNames.js` (`useWorkEntityNames({ workModel, activeSummary, observed }) -> EntityNames`, `useMemo` inside)
- Modify: `frontend/src/eng/useEngSprintData.js` (own `useState` for `workTypes`; set only from full Catch Up reads — not `automatic`, `epicRefresh` or non-`catch_up` purposes; merge lanes: sum counts, union keys ≤ 20, observed names from either lane; reset when `workContextKey` changes; returned as `workTypes`)
- Modify: `frontend/src/dashboard.jsx` (call `useWorkEntityNames` beside `:575`; add `entityNames` to `epicBlockProps` `:6236`)
- Modify: `frontend/src/eng/planningReviewKinds.js` (`reviewLabels(names = resolveEntityNames(WORK_MODEL_LEGACY))`, `parentColumnId` from `names.model`), `frontend/src/stats/statsScope.js` (`roleLabels(names)`; `describeStatsScope` resolves names from `summary.roleTypes`)
- Test: `tests/test_work_entity_names.js` (new), `tests/test_work_structure_stats.js`, `tests/test_eng_sprint_data_work_types.js` (new)

**Interfaces:**
- Produces:
  - `resolveEntityNames(model, roleTypes = null, observed = null, digest = null) -> EntityNames` with `EntityNames = { model, child, childPlural, parent, parentPlural, ancestor, ancestorPlural, optionalAncestor, childKind, parentKind, ancestorKind, childLevel, parentLevel, ancestorLevel }`; `*Kind ∈ 'story'|'epic'|'initiative'|'objective'` (level 0 story, 1 epic, 2 initiative, ≥3 objective).
  - `observed = { digest, planning: string|null, parent: string|null }`, used only when `observed.digest === digest`.
  - `pluralizeEntityName(name)`, `lowerEntityWord(word)`, `formatEntityCount(count, names, role)` with `role ∈ 'child'|'parent'|'ancestor'`.
  - `useEngSprintData` returns `workTypes = { digest, observed: {planning, parent}, linkMismatches: {parentCount, ancestorCount, keys} } | null`.

- [ ] **Step 1: Failing tests** (`tests/test_work_entity_names.js`): Legacy defaults `{child:'Story', childPlural:'Stories', parent:'Epic', parentPlural:'Epics', ancestor:'Initiative', childKind:'story', parentKind:'epic', ancestorKind:'initiative'}`; DELIVERY roleTypes → Epic/Initiative/Objective, kinds epic/initiative/objective; `optionalAncestor:'Strategy'` default; renamed `Deliverable` L1 → `child:'Deliverable'`, `childKind:'epic'`; observed `{digest:'d1', planning:'Work Package'}` with digest `d1` → `Work Package`, with `d0` → capture; levels `[3,2,1]` (non-increasing) → defaults; plural/case cases of Review Focus 2; `formatEntityCount(1,names,'child')==='1 Epic'`, `(0,…)==='0 Epics'`. `tests/test_eng_sprint_data_work_types.js`: two lanes merge (counts summed, keys unioned ≤ 20), an `automatic` read does not overwrite, a context change resets to `null`.
- [ ] **Step 2:** `node --test tests/test_work_entity_names.js tests/test_eng_sprint_data_work_types.js` → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run build && npm run test:frontend:unit`, budgets + regrowth guard → pass.
- [ ] **Step 5:** Commit `Resolve work entity names from the configured Jira types`.

### Task 3: Observed names and new-model link mismatches (server)

**Files:**
- Modify: `backend/services/planning_work.py` (`WorkRoles.summarize_links(issues, epic_details, ancestor_misses) -> dict`)
- Modify: `jira_server.py` `fetch_tasks` (≈3562–4022: compute `workTypes` on the cache-miss path from raw rows before trimming and store it in `data` before `publish_result` ≈4006, so cache hits ≈3618 return it; only for the full Catch Up purpose) and `fetch_epic_details_bulk` (≈3050: optional `ancestor_misses=None` list collector, return value unchanged)
- Modify: `backend/routes/eng_routes.py:540-545` (new model only: `initiative` set only when the parent matches the ancestor role; response `ancestorMismatchCount`; Legacy/`roles is None` unchanged; no ancestor type → unchecked)
- Modify: `frontend/src/eng/EngView.jsx` (notice from `workTypes`)
- Test: `tests/test_work_type_validation.py` (new), `tests/test_story_readiness.py`, `tests/ui/work_structure_catchup_warnings.spec.js`

**Interfaces:**
- Produces: tasks `data.workTypes = {"digest": "<configuration digest>", "observed": {"planning": "Epic", "parent": "Initiative"}, "linkMismatches": {"parentCount": 1, "ancestorCount": 0, "keys": ["PLAN-2"]}}` for new-model full reads; absent for Legacy and other purposes. `observed.planning` = `issuetype.name` of returned planning rows; `observed.parent` from embedded parents accepted by `parent_ref_matches` with a type. No row shape or cache key change.

- [ ] **Step 1: Failing tests** (`tests/test_work_type_validation.py`; mocks honour the JQL type filter), including a no-request-context call of `fetch_epic_details_bulk` with the collector: DELIVERY Epics `PLAN-1` (parent `I-1` type `11700`), `PLAN-2` (parent `S-9` type `10001`), `PLAN-3` (parent without issuetype) → `PLAN-2` and `PLAN-3` in rows, `parentCount == 1`, `keys == ['PLAN-2']`, `observed == {'planning':'Epic','parent':'Initiative'}`; Initiative `I-1` with a parent of type `10002` → `ancestorCount == 1`; 25 bad parents → 20 keys, count 25; cache hit returns the same `workTypes`; Legacy response has no `workTypes`; readiness new model: non-ancestor parent → no `initiative`, `ancestorMismatchCount == 1`; readiness Legacy unchanged (existing cases pass).
- [ ] **Step 2:** `.venv/bin/python -m unittest tests.test_work_type_validation tests.test_story_readiness -v` → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Playwright DELIVERY fixture with one bad parent link: one notice `1 Epic in this quarter has a Jira parent that is not an Initiative. An administrator can review Field mapping in Settings.` (plural `2 Epics … have …`; ancestor variant `1 Initiative … has a Jira parent that is not an Objective.`); row visible; Legacy fixture shows no notice. `npx playwright test tests/ui/work_structure_catchup_warnings.spec.js --browser=chromium` → pass. Budgets test.
- [ ] **Step 5:** Commit `Report new-model work whose Jira parent is not of the configured type`.

### Task 4: Catch Up and alerts

**Files:** `frontend/src/eng/EngFilterControls.jsx:40,53,86,97` (pluralise on `realStoryCount`), `engCatchUpFilters.js:34,248` (`buildEngCatchUpFacetModel`, `resolveEngCatchUpFilters` take `names`), `EngAlertsPanel.jsx:12,14,115,167,210-211,570,572,652,770,962`, `futurePlanningNeedsStories.mjs:6-15` (`getFuturePlanningNeedsStoriesReasonText(reason, names)`; call path `useAlertPin.js:67,94` → `dashboard.jsx:6960` → `EngAlertsPanel.jsx:694`), `StoryRequirementCard.jsx:5-19,58,72,79`, `EpicBlock.jsx:75,122,145-159,273,348-365`, `issues/IssueCard.jsx:149-151,169,227-235,280`, `EngView.jsx:114,136-165,178`, `dashboard.jsx:229` (`InitiativeIcon` default title from names), `dashboard.jsx:4438` (readiness names), `:5607`, `engWorkHierarchy.js:41,55,64`, `useEngAlerts.js:31`, `epicRefreshAlerts.js`, `useEpicRefresh.js:40-45`; CSS only if a new icon context needs a registered rule (`docs/design-system.md` entry in the same commit).

**Interfaces:** Consumes Task 2. `IssueCard` gains props `entityNames` and `isPlanningLeaf` (editable-leaf test uses the role, not `story|epic` names); without `entityNames` (EPM) it renders exactly as today. Icon by level per D3a; `title={names.child.toUpperCase()}`.

- [ ] **Step 1: Failing tests** (DELIVERY fixture and renamed fixture: planning `Deliverable` L1, parent `Theme` L2, ancestor `Objective` L3):
  - readout `/5 epics · 1 required/i` (renamed `/5 deliverables · 1 required/i`); Legacy `/1 story · 2 required/i`.
  - pill `1 Epic required` / `2 Epics required`; Legacy `1 Story required`; pin note equals the plural label without count (`Epics required`; Legacy `Stories required` unchanged).
  - card title `Epic required`; aria `…: Epic required for <Team>, target sprint 2027Q1. Opens the Initiative in Jira to create the Epic.`; renamed `Deliverable required … Opens the Theme …`.
  - icons: DELIVERY child bolt `title="EPIC"`, parent lightbulb `title="INITIATIVE"`, group line `title="OBJECTIVE"`; renamed `DELIVERABLE`/`THEME`; Legacy `STORY`/`EPIC`/`INITIATIVE` unchanged; EPM rollup cards unchanged.
  - reasons `No Epics yet for this sprint.`…; Legacy reason strings unchanged; readiness copy uses captured names.
  - epic-header one-row geometry (AGENTS.md section 11) for direct and initiative-grouped headers in DELIVERY.
  - Deliberately changed pins: `tests/ui/eng_missing_story_ghosts.spec.js:507,519`, `tests/test_work_structure_classification.js:138,139`, `tests/test_dashboard_alert_source_guards.js:390-400` (raw constant becomes a builder), alert-pin specs/fixtures only where a count of 1 renders. `eng_alerts_panel_summary.spec.js` "1 Empty epic" stays (fixed singular).
- [ ] **Step 2:** Run the unit files and `tests/ui/eng_missing_story_ghosts.spec.js tests/ui/eng_alerts_panel_summary.spec.js tests/ui/eng_alert_pin.spec.js tests/ui/eng_epic_refresh.spec.js tests/ui/work_structure_catchup_warnings.spec.js` (Chromium) → new cases fail.
- [ ] **Step 3:** Implement; before/after screenshots of the DELIVERY Catch Up fixture (animations settled), diff described in Outcome.
- [ ] **Step 4:** `npm run build`, unit tests, the specs, budgets + regrowth guard → pass.
- [ ] **Step 5:** Commit `Name Catch Up counts, alerts and rows by the configured Jira types`.

### Task 5: Analytics kinds from roles

**Files:** `frontend/src/analytics/externalLinks.js:1`, `analytics/dashboardAnalytics.js:12,72,82`, `eng/engStatusTransitionUtils.js:71-123,178`, `engPriorityTransitionUtils.js:152`, `engProjectTrackTransitionUtils.js:36`, `StatusTransitionMenu.jsx`/`PriorityTransitionMenu` (new `issueKind` prop to `onOpen`), call sites `StoryRequirementCard.jsx:72`, `EpicBlock.jsx:122`, `IssueCard.jsx:169`, `EngBoardEpicCard.jsx:64`, `EngBoardEpicPanel.jsx:271,285`, `PlanningReviewTable.jsx:245,408,415`, `dashboard.jsx:5895` (map `row.rowKind` through the role → kind map); `docs/README_ANALYTICS.md:108,117-120,210,302`; `docs/plans/SUPPORT-ga4-user-configuration.md:428-435` (add `objective`; add the already-allowed `initiative` missing at `:435`); tests `tests/test_work_structure_analytics.js`, `tests/test_analytics_source_guards.js`, `tests/test_analytics_events.js`, `tests/test_eng_status_transition_utils.js:80-85`.

**Interfaces:** Consumes `*Kind`. `SAFE_ISSUE_KINDS` and `ISSUE_FIELD_EDIT_KINDS` add `objective`. `buildCatchUpStatusTargets(issue, fallbackIssueType, issueKind)`; targets carry `issueKind`; `summarizeIssueTypeMix` returns `epics|stories|subtasks|initiatives|objectives|mixed` from `issueKind` when present, else today's name rule (EPM/cohort/Stats callers outside scope keep it). The `selected_sp_bucket` gate at `:178` keys on the planning leaf (`issueKind === names.childKind`), so DELIVERY Planning Epics keep their SP bucket.

- [ ] **Step 1: Failing tests:** DELIVERY Epic link → `issue_kind=epic`; Initiative → `initiative`; ancestor → `objective`; requirement card (opens the parent) → `initiative` DELIVERY, `epic` Legacy; Board panel field edit on renamed `Deliverable` → `issue_kind=epic` and emitted (today dropped); two DELIVERY Initiatives status change → `issue_type_mix=initiatives`; DELIVERY Planning Epic selection keeps `selected_sp_bucket`; Legacy events unchanged; guard: in-scope ENG call sites pass a kind from role/`names`, not a literal or `names.x.toLowerCase()`.
- [ ] **Step 2:** `node --test tests/test_work_structure_analytics.js tests/test_analytics_source_guards.js tests/test_analytics_events.js tests/test_eng_status_transition_utils.js` → fails.
- [ ] **Step 3:** Implement; doc rows (native kind from role+level, enum values, mix values, "no new event" reason).
- [ ] **Step 4:** Re-run + `.venv/bin/python -m unittest tests.test_agents_md_learnings` → pass.
- [ ] **Step 5:** Commit `Send each row's role kind in analytics for every configuration`.

### Task 6: Planning, Board, Statistics, Scenario, onboarding; literal guard

**Files:** Planning `PlanningActionBar.jsx:63-120`, `PlanningAssigneeCapacity.jsx:176`, `PlanningProjectSplitBar.jsx:36`, `PlanningReviewTable.jsx:63,403`, `planningReviewTableModel.js:68,79,162,180,182`, `dashboard.jsx:5299-5330` (Jira links use `issuetype = <planning id>` in the new model); Board `EngBoardView.jsx:113,1070,1279`, `EngBoardEpicPanel.jsx:54-55,311`, `EngBoardEpicCard.jsx:29`, `EngBoardHelp.jsx:106-108`, `engBoardColumns.js:28`, `engBoardFilters.js:23,185`; Stats `StatsPanel.jsx:744,765,841,844,963,1033`, `LeadTimesEpicCharts.jsx:35,57`, `StatsTeamsView.jsx:82,115` (type ids in the new model), `OpenEpicsChart.jsx:99,105`, `BurnoutChart.jsx:338`; `ScenarioView.jsx:15`, `scenarioUtils.js:188`; `JiraExportButton.jsx:140,147`, `ShareViewButton.jsx:27` (copy only); onboarding `onboarding/onboardingSteps.js` (frozen catalog → `buildOnboardingSteps(names)` and `ONBOARDING_STEPS_BY_MODULE` built from it; consumers `OnboardingTour.jsx`, `useOnboardingTour.js`, `dashboard.jsx`; step ids/targets unchanged; DELIVERY "initiative" target = the ancestor group line) and tests `tests/test_onboarding_modules.js`, `tests/test_onboarding_tour_*.js`; guard `tests/test_work_entity_literal_guard.js` (new); spec `tests/ui/work_structure_entity_names.spec.js` (new).

**Interfaces:** Consumes Task 2.

- [ ] **Step 1: Failing guard.** Scan the in-scope files of Tasks 4 and 6, and only the named line ranges of `dashboard.jsx`. Strip comments. Match `/\b(stor(y|ies)|epics?|initiatives?)\b(?!\s+points)/i` in (a) JSX text, (b) values of `title|aria-label|placeholder|alt|label|data-tooltip|fieldLabel|emptyMessage` attributes and of `title =` parameter defaults — single words included, and (c) other string/template literals that are not `className` values, not selector arguments (`querySelector*`, `closest`, `matches`) and not single tokens `^[\w-]+$` — except a single capitalised word (`^(Story|Stories|Epic|Epics|Initiative|Initiatives)$`), which is flagged. Skip lines containing `issuetype`, `"Epic Link"` or `jql`. Allowlist `{file, snippet, reason}`: Legacy-only branches, `Story Points`, `Sprint SP`, tokens listed in Global Constraints. Fails today (includes `ShareViewButton.jsx:27`, `OpenEpicsChart.jsx:99,105`, `BurnoutChart.jsx:338`, `dashboard.jsx:229`, `EpicBlock.jsx:145`).
- [ ] **Step 2: Failing spec.** Renamed DELIVERY fixture: Catch Up, Planning Table, Board, Statistics and the tour show `Deliverable(s)`/`Theme(s)`; inside `.task-list`, the Planning table, `.board-*` root and the Stats panel, text matching `/\b(stor(y|ies)|epics?)\b/i` occurs only in `Story Points` (assert via `innerText` with `Story Points` removed).
- [ ] **Step 3:** Implement surface by surface; before/after screenshots of Planning Table, Board, Statistics in the DELIVERY fixture. Deliberately changed pins: `tests/ui/eng_group_board_view.spec.js:3564,3594,5990` (`1 of 1 epic`), plus any guard-listed copy tests.
- [ ] **Step 4:** `npm run build`, unit tests, guard, new spec, `tests/ui/eng_group_board_*.spec.js`, `tests/ui/planning_review_table*.spec.js`, onboarding tests, budgets + regrowth guard → pass.
- [ ] **Step 5:** Commit `Use configured Jira type names on Planning, Board, Statistics and the tour`.

### Task 7: Coverage proof, docs, full gate

**Files:** this plan (Outcome, Current Accuracy), `docs/features/alerts.md`, `docs/features/eng-workflows.md`, `docs/ontology.md` (work-structure section: `roleTypes`, `workConfigurationTypeNames`, `workTypes`, `resolveEntityNames`; never line 3; date only the touched section's `Verified on`), parent EXEC plan "Still literal" line, `docs/plans/README.md`.

- [ ] **Step 1: Coverage matrix** in Outcome: rows = admin selections (Legacy planning names, Legacy parent/ancestor mode, DELIVERY planning, parent, ancestor, optional ancestor); columns = Catch Up readout, alerts, requirement card, icons, Planning, Board, Statistics, Scenario, tour, analytics kind, mismatch notice; each cell names the proving test (renamed fixture) or "not rendered" with reason. An empty cell blocks Done.
- [ ] **Step 2:** Task 0 Step 2 against the signed-in app; rendered names equal `/api/issue-types` names for the configured ids.
- [ ] **Step 3:** Full gate: `npm run build`, `python3 -m unittest discover -s tests` (clean env as in the parent plan's Runs note), `npm run test:frontend:unit`, `npx playwright test tests/ui --browser=chromium --workers=4`; record actual results; explain each pre-existing failure.
- [ ] **Step 4:** Rename to `DONE-*`, update README entry and links, commit.

## Review log

- Round 1 (2026-11-03; backend-contracts and frontend/analytics reviewers): validation retargeted from rows to parent/ancestor links and the unchecked readiness slot; Task 0 via `/api/issue-types`; storage outside the bundle; digest exclusions; Legacy name rule; D3a level from the role; observed precedence by digest; token-vs-name rule; null-level fallback; precise guard; missed surfaces; analytics enum/runbook rows; per-task budgets; ownership and ontology docs; singular counts in Legacy with changed tests listed.
- Round 2 (2026-11-03; same split, fresh reviewers): key popped from `sharedConfig`; names-only write path and `_save_first`; `workTypes` computed on the cache-miss path for the full purpose only; frontend consumer, lane merge and reset in `useEngSprintData`'s own state; side-channel collector for `fetch_epic_details_bulk`; permission-reduced links not counted; mismatches new-model only; readiness Legacy/no-ancestor rules; level monotonicity guard; name length 255; explicit `entityNames` props instead of `IssueCardContext`; real function names and call paths; `dashboard.jsx` ceiling rule; `issueKind` through status targets and the SP-bucket gate; guard false positives/negatives; extra Legacy pins; analytics doc lines; onboarding consumers.

## Outcome

Not started.
