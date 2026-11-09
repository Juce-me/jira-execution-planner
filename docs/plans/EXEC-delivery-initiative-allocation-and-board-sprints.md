# DELIVERY Initiative Allocation and Board-only Sprints Implementation Plan

> **Status:** Planned, not started (2026-11-09). Branch `feature/quarterly-allocation-split-sprint-scoping` (PR 334), base for execution `35c110d3`. Reworks parts of [DONE-delivery-allocation-split-and-sprint-scoping.md](DONE-delivery-allocation-split-and-sprint-scoping.md); that plan stays the record of what shipped first.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In DELIVERY (`rnd_2027`), Product/Tech becomes an Initiative property read only from the Initiative's own Allocation, with a third class "No Allocation" that the filter, capacity totals, split bar, alerts and Stats show like "No Project Track"; Board-mode Sprints come only from the Board (own or inherited), split between configurations by quarter range; "Refresh Sprint values" reads the effective (inherited) Board and Sprint field.

**Architecture:** The server classifies each Initiative once (`product` | `tech` | `none`) and stamps that class on the Initiative record and on every child issue (`projectClassification`), so the client never maps Allocation values. The client gates every three-class behaviour on the DELIVERY model and keeps Legacy output byte-identical. The Board-mode issue-scan supplement is deleted, so a Board-mode configuration has exactly one Sprint source.

**Tech Stack:** Python 3 / Flask, React 19 + esbuild, `unittest`, node test runner (`npm run test:frontend:unit`), Playwright.

**Spec (owner decisions, 2026-11-09, in chat):**
- "the sprint should be inherited from the configuration project: legacy has certain limit and delivery has starting point. so, they should not intersect" — and, asked why DELIVERY scans issues: "why do we need to scan delivery for sprint, if we use a board to sprints or specific sprint value?" → chosen: **Board, split by range**; Sprint-field mode unchanged; `- legacy`/`- delivery` suffix stays.
- Finding 5 (Refresh Sprint values skips an inherited DELIVERY): "fix".
- Finding 7 (Initiative alerts split by Jira project): "that's a fail. fix it. product and tech became like project type (flexible, committed or none) filter. let's redo it."
- Finding 2 (Ad Hoc facet/capacity mismatch): "we're mapping initiative for delivery for tech or prod in the allocation categories".
- Source: **Initiative only** (Epic and Objective values ignored).
- Unmapped/blank in totals: "no allocation. like the project track value → No allocation".

## Global Constraints

- Everything stays behind `WORK_CONFIGURATIONS_ENABLED`, DB/OAuth only (as in the DONE plan).
- Legacy behaviour, payloads and fixtures (`LEGACY_CLASSIFICATION_EXPECTED`, Legacy Board `product|tech|other`) are unchanged; every three-class branch is gated on the DELIVERY model (`roles.is_legacy` on the server, `names.model` / `workModel` / `isCombinedWorkModel` on the client).
- Class values are exactly `'product'`, `'tech'`, `'none'`. The user-visible label for `'none'` is exactly **No Allocation**.
- One DELIVERY lane request (`project=all`) stays; no new Jira request per Initiative. Removing the Objective batch and the Epic-level Allocation field is required, not optional.
- Root AGENTS.md section 10/11 rules apply: reuse facet/empty-state machinery (`engFilterFacets.js`, `EngFilterBar.jsx`), reuse `PlanningProjectSplitBar`, no new pill/chip class without a ratchet entry, `frontend/dist` never committed, owner budgets re-synced deliberately, analytics impact recorded.
- Commit identity: `git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit`; no agent attribution trailers or branding.

## Lead defaults (owner silent; stated here, change before execution if wrong)

1. **Ad Hoc follows the mapping.** In DELIVERY an Ad Hoc Initiative's work counts on its mapped side (`product`/`tech`/`none`) in the facet, capacity totals and split bar; it keeps `capacityType: 'ad_hoc'`, and the split bar draws its Ad Hoc subsegment inside whichever side holds it. Legacy keeps Ad Hoc → Product.
2. **Unreadable Initiative** (batch failed or Initiative missing from the details map) is `none`, like blank.
3. **70/30 target** stays 70% of the whole bar; the No Allocation segment is drawn last (after Tech) in the existing neutral/excluded tone, with tooltip "No Allocation". `capacitySplit`/`capacityMultiplier` keep reading only Product and Tech.
4. **Shared Board between configurations:** when two Board-mode configurations resolve the same Board, each lists (Sprint selector, Scope picker, admission) only the rows inside its own quarter range. A configuration with its own unique Board keeps the current range-agnostic Scope picker.
5. **Stale Sprint ids** admitted earlier from the scan (for example a DELIVERY id that is not on the Board) now answer `409 sprint_catalog_mismatch`; accepted, the feature is unreleased behind the flag.
6. **Share links:** DELIVERY uses a new key `alloc` (`product,tech` ids; `none` = explicit empty = "No Allocation only"; omitted = neutral). Legacy keeps `lanes`. Board keeps `bprojects`; its vocabulary gains `none` for DELIVERY.

## Review Focus

1. An Initiative with **no child issues** on the Board still shows its class (it must come from the Initiative, not from children) — Task 4 test `test_delivery_epic_frame_carries_its_own_class_without_children`.
2. **Both facet options unticked** in DELIVERY shows only No Allocation work and survives reload and share link — Task 6 tests `allocation facet empty selection persists` and codec `alloc=none`.
3. A DELIVERY **Ad Hoc Initiative mapped Tech** is Tech in the facet and in totals (the finding 2 mismatch is gone) — Task 5 test `ad hoc follows the Initiative class in DELIVERY`.
4. Two configurations **sharing one Board**: each Sprint list and Scope picker shows only its range, and a Legacy id is rejected for DELIVERY — Task 1 test `test_shared_board_splits_by_range_in_lists_admission_and_scope_picker`.
5. **Legacy unchanged** with a DELIVERY workspace present (no `none`, no `alloc` key, Ad Hoc still Product) — every task keeps its Legacy assertion; Task 5 and 6 add explicit Legacy cases.

---

### Task 1: Board-only Sprint source, split by range

**Files:**
- Modify: `backend/services/workspace_catalog_config.py` (delete the `observed` block in `_entry_catalog_config` ~:437-452; delete fields `observed_source`, `is_observed_supplement`, `board_inherited` :38-44; restore `resolve_catalog_sources` to a plain comprehension; drop `observed=` from `resolve_configuration_catalog_config`)
- Modify: `backend/services/catalog_app_adapter.py:45-52` (drop `observed=`)
- Modify: `backend/routes/eng_routes.py:2165-2166` (drop `observed=`)
- Modify: `backend/routes/settings_routes.py` (`_configuration_source_result` :885-965: remove the inherited branch and the supplement merge; `_configuration_completion_response` :1069-1120: remove the `board_inherited` clause and `row_source`, use `config`; `identity_of` may stay)
- Modify: `backend/routes/work_structure_routes.py` (`admit_sprint_source` :245-301: remove :269-292 supplement/inherited paths; `collect_sprint_values` :425-483: one source per configuration plus the shared-Board range rule)
- Test: `tests/test_work_structure_catalogs.py`, `tests/test_work_structure_sprint_values.py`

**Interfaces:**
- Produces: `EffectiveCatalogConfig` without `observed_source` / `is_observed_supplement` / `board_inherited`. `collect_sprint_values` rows unchanged in shape (`configurationIds`, suffix labels).
- Shared-Board rule: two sources share a Board when `source_mode == 'board'` and equal `sprint_identity`; then `collect_sprint_values` filters that configuration's rows with `in_range_sprints(config, payload)` (`backend/services/workspace_catalog_cache.py:282`).

- [ ] **Step 1: Rewrite the tests to the target.**
  - `SourceCatalogTests.test_board_and_issue_sources_merge_in_range_with_original_ids` → rename `test_inherited_board_splits_by_range_with_original_ids`; assert merged rows `[(102,'2027Q1','delivery'),(101,'2026Q4','legacy')]` (main's expectation) and `fake.search_jql == []` (no scan).
  - `test_blank_source_is_setup_required_and_does_not_lock_the_other_era` → DELIVERY with inherited Board and no projects/Sprint field is `ready` with Board rows (main's expectation); rename accordingly.
  - Delete `test_failed_observed_scan_keeps_the_shared_board_sprints` and every `ObservedOnBoardConfigurationTests` test, then add to a renamed class `BoardModeConfigurationTests`:
    - `test_board_mode_never_scans_issues`: own Board 19095 for DELIVERY; GET `?configurationId=delivery` → only Board rows; no JQL containing `is not EMPTY`.
    - `test_legacy_borrowing_the_delivery_board_keeps_its_board_rows` (keep; assert Legacy rows from Board 19095 within Legacy range).
    - `test_shared_board_splits_by_range_in_lists_admission_and_scope_picker`: inherited Board 7001 with 2026Q4 and 2027Q1 rows; DELIVERY list = 2027Q1 only, Legacy list = 2026Q4 only; `/api/teams?sprint=<2026Q4 id>&configurationId=delivery` → 409 `sprint_catalog_mismatch`; `/api/work-structure/sprint-values` lists each name once, under its in-range configuration, no suffix.
    - `test_inherited_board_completion_reads_board_rows`: refresh then completion poll for DELIVERY returns its in-range Board rows (200).
  - `tests/test_work_structure_sprint_values.py`: `test_setup_required_and_pending_sources_are_reported_not_errors` back to main's `pending`; `test_union_is_range_agnostic_sanitized_and_never_reads_jira` and `test_a_name_in_both_configurations_is_one_labelled_row_per_configuration` use a DELIVERY own Board row (not scan id 45459/201) for the same-name case; delete `test_inherited_board_contributes_only_the_delivery_scan`; `SourceDiagnosticsTests` Board sources report null scan counts (drop DELIVERY `scannedIssueCount`/`observedSprintCount` expectations; the failed-scan case moves to a Sprint-field-mode configuration).
- [ ] **Step 2: Run, expect failures.** `<PYENV> .venv/bin/python -m unittest tests.test_work_structure_catalogs tests.test_work_structure_sprint_values` → FAIL (scan JQL issued, scan ids listed).
- [ ] **Step 3: Implement** the deletions listed under Files and the shared-Board rule.
- [ ] **Step 4: Run** the two modules plus `tests.test_work_structure_scope_selection tests.test_eng_routes tests.test_work_reader_routes` → OK. Then `grep -rn "observed_source\|is_observed_supplement\|board_inherited" backend tests` → no hits.
- [ ] **Step 5: Commit** "Read Board-mode Sprints from the Board only, split by range".

`<PYENV>` = `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access'`.

### Task 2: Refresh Sprint values reads the effective entry

**Files:**
- Modify: `frontend/src/settings/useWorkConfigurationSettings.js:183`, `frontend/src/settings/WorkConfigurationsEditor.jsx:71`
- Test: `tests/test_work_structure_settings.js`, `tests/ui/work_structure_scope_sprint_values.spec.js`

**Interfaces:**
- Consumes: `effectiveEntry(entries, entry)` and `savedSourceReady(entry)` from `frontend/src/settings/workConfigurationModel.js` (existing).
- Produces: `refreshableSources(configurations)` exported from `workConfigurationModel.js` = `configurations.filter(entry => savedSourceReady(effectiveEntry(configurations, entry)))`; both call sites use it.

- [ ] **Step 1: Tests.** Node: `refreshableSources: an inherited Board and shared Sprint field make DELIVERY refreshable` (Legacy `boardId:'7001'`, DELIVERY `boardId:''`, blank Sprint field → both ids returned) and `a configuration with no Board, no projects and no inherited Board is not refreshable`. UI: in the spec add `Refresh Sprint values includes a DELIVERY that inherits Legacy's Board` (fixture variant with DELIVERY `boardId: ''`; assert the refresh request list contains `configurationId=delivery`).
- [ ] **Step 2: Run** `node --test tests/test_work_structure_settings.js` → FAIL (`refreshableSources` undefined).
- [ ] **Step 3: Implement** `refreshableSources` and use it at both call sites.
- [ ] **Step 4: Run** node test → PASS; `npm run build && npx playwright test tests/ui/work_structure_scope_sprint_values.spec.js --browser=chromium` → PASS.
- [ ] **Step 5: Commit** "Refresh Sprint values for a configuration that inherits its Board".

### Task 3: Server classifies each Initiative once

**Files:**
- Modify: `backend/services/allocation_classification.py` (replace `_resolve`, `objective_keys_to_read`, `stamp_epics`)
- Modify: `jira_server.py` (`fetch_epic_details_bulk` :2992-3076, `allocation_stamps` :3079-3096, `fetch_tasks` :3790-3793 and :3988-4032, excluded-capacity :6273-6320, :6424-6425, :6496-6499)
- Modify: `backend/routes/eng_routes.py:574` (readiness Epic `projectClass`)
- Test: `tests/test_allocation_classification.py`, `tests/test_work_reader_routes.py` (`AllocationStampTests`), `tests/test_work_structure_stats.py:444`, `tests/fixtures/work_structure_reference.py:116-133`, `tests/test_work_structure_reference_fixture.py`, readiness tests in `tests/test_eng_routes*.py` (find with `grep -rn projectClass tests`)

**Interfaces:**
- Produces: `classify_initiative(raw_value, allocation_types) -> 'product' | 'tech' | 'none'` (blank or unmapped → `'none'`; mapped Product → `'product'`; mapped Tech → `'tech'`).
- Produces: `initiative_classes(epic_details, field_id, allocation_types) -> {initiative_key: class}`.
- Produces: in DELIVERY, `epic_details[key]['allocationClass']` on every Initiative record returned as `data['epics']`; each issue's `fields.projectClassification` = its Initiative's class, `'none'` when the Initiative is absent from `epic_details` or the issue has no Initiative. Excluded-capacity summaries and items carry the same. Readiness Epics (Initiatives) in DELIVERY carry `projectClass` = their own class.
- Removed: `objective_keys_to_read`, the Objective batch in `allocation_stamps`, the Epic-level Allocation field on the lane request (:3792-3793) and excluded-capacity items (:6424-6425). `planning_work.resolve_allocation` stays (no production caller) but stops being the oracle.

- [ ] **Step 1: Tests.** Pure: `test_initiative_value_decides`, `test_blank_or_unmapped_is_none`, `test_epic_and_objective_values_are_ignored` (`stamp` of an Epic whose own value is Tech under a Product Initiative → product). Routes: replace `test_stamp_follows_epic_then_initiative_then_one_objective_batch` with `test_stamp_is_the_initiatives_class_and_no_objective_batch` (assert lane fields exclude the Allocation field, no `issueKey in` Objective search, `data['epics'][INIT]['allocationClass']`); `test_failed_objective_batch_is_product` → delete; add `test_unreadable_initiative_is_none`; keep `test_alerts_request_reads_no_allocation` and `test_legacy_request_has_no_allocation_field_or_stamp`. Stats/fixture: expected pairs say an unmapped Initiative is `none`. Readiness: `test_delivery_readiness_epic_project_class_is_its_allocation_class`; Legacy readiness unchanged.
- [ ] **Step 2: Run** the listed modules → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** the listed modules plus `tests.test_issue_edit_cache_generation tests.test_codebase_structure_budgets` → OK.
- [ ] **Step 5: Commit** "Classify DELIVERY work by its Initiative's Allocation only".

### Task 4: Board carries the Initiative class

**Files:**
- Modify: `backend/services/eng_board.py` (`_allocation_class` :853-862, `project_board` :1043-1097, epic shape :1107-1121)
- Modify: `backend/routes/eng_board_routes.py` (delete `_objective_allocations` and `allocation_objectives`; drop Allocation from `child_fields` :958; keep it in `epic_fields`)
- Modify: `backend/services/eng_board_stream.py:352-356, :386`, `frontend/src/api/engBoardApi.js:123-127, :156`, `backend/routes/dev_routes.py:476`
- Test: `tests/test_eng_board_service.py:805`, `tests/test_work_reader_routes.py` (`ComponentBoardStreamTests` :564, :586; `BoardObjectiveBatchTests` → delete), `tests/test_eng_board_stream.py`, `tests/test_eng_board_api.js` or the existing engBoardApi node test (find with `grep -rln engBoardApi tests`)

**Interfaces:**
- Produces: DELIVERY Board epic frame key `projectClassification` (`'product'|'tech'|'none'`); Legacy epic frames omit it (exact-key lists accept it optionally only when the snapshot is DELIVERY). Children `projectClassification` in DELIVERY = epic's class; validators accept `'none'` in addition to `product|tech|other`. Bump the Board stream/cache version constant if one keys frame shape (check `eng_board_stream.py` for a version; if none, note it).

- [ ] **Step 1: Tests.** `test_delivery_epic_frame_carries_its_own_class_without_children`; `test_delivery_children_inherit_the_initiative_class` (child with own Tech value under unmapped Initiative → `none`); `test_board_reads_no_objective_and_no_child_allocation_field`; stream/api validators accept `none` and reject `bogus`; Legacy frame unchanged.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `tests.test_eng_board_service tests.test_eng_board_stream tests.test_work_reader_routes` and the node api test → OK.
- [ ] **Step 5: Commit** "Carry the Initiative Allocation class on DELIVERY Board frames".

### Task 5: Three-class capacity, Ad Hoc follows the mapping, split bar

**Files:**
- Modify: `frontend/src/capacityClassification.mjs` (`projectStamp` :25-28, `isTechIssue` :31-40, `classifyCapacityIssue` :42-58)
- Modify: `frontend/src/eng/useEngCapacity.js:73-123`, `frontend/src/eng/planningCapacityUtils.js` (:375-404, :420-460, :462+, :519-543), `frontend/src/eng/planningSelectionStats.js:52-93`, `frontend/src/eng/PlanningProjectSplitBar.jsx`
- Test: `tests/test_capacity_classification.js:100`, `tests/test_work_structure_classification.js:36, :106`, `tests/test_planning_selection_stats.js:182`, `tests/ui/work_structure_one_lane.spec.js:123` (+ entry `tests/ui/work_structure_one_lane.entry.jsx:17-20`)

**Interfaces:**
- Produces: `projectClassOf(issue, techProjectKeys) -> 'product'|'tech'|'none'` in `capacityClassification.mjs` (stamp `'none'` → `'none'`; Legacy path unchanged, never `'none'`). `classifyCapacityIssue` returns `projectType: 'none'` for a `'none'` stamp, and in DELIVERY (any stamp present) Ad Hoc no longer forces `projectType: 'product'` — it keeps `capacityType: 'ad_hoc'` with the stamped side. `isTechIssue` stays boolean (`=== 'tech'`).
- Produces: capacity/selection stat objects gain a `NONE` / `none` bucket (label "No Allocation") only when the model is DELIVERY; Legacy objects keep exactly their current keys.
- Split bar: third segment `No Allocation` after Tech, neutral tone from existing tokens; Ad Hoc subsegment drawn inside the side that holds it.

- [ ] **Step 1: Tests.** `ad hoc follows the Initiative class in DELIVERY` (Ad Hoc + stamp tech → projectType tech, capacityType ad_hoc); `unmapped stamp is No Allocation, never Product`; `Legacy Ad Hoc in a Tech project is still Product` (keep); selection stats `new model buckets include No Allocation`; UI split bar screenshot `new-model split bar shows Product, Tech and No Allocation` with element assertions that the three segments' widths sum to the bar and the 70% marker stays at 70%.
- [ ] **Step 2: Run** `npm run test:frontend:unit` (or the three node files) → FAIL. **Step 3: Implement.** **Step 4: Run** node tests → PASS; build + `npx playwright test tests/ui/work_structure_one_lane.spec.js --browser=chromium` → PASS; look at the screenshot.
- [ ] **Step 5: Commit** "Count DELIVERY No Allocation work as its own capacity bucket".

### Task 6: Allocation facet like Project Track, alerts, persistence, share links

**Files:**
- Modify: `frontend/src/eng/engCatchUpFilters.js` (`buildEngCatchUpFacetModel` :121-191, `resolveEngCatchUpFilters` :204-263, `readEngCatchUpFilterState` :295-312)
- Modify: `frontend/src/eng/engBoardFilters.js` (:71-198), `frontend/src/eng/engBoardCardModel.js:14-33` (`classifyEpicProjects`: `'none'` is not Tech)
- Modify: `frontend/src/eng/useEngAlertFilters.js:54-64`, `frontend/src/eng/engWorkHierarchy.js:176-183, :306-310` (readiness rows: DELIVERY admits by class incl. `none`; this closes the `docs/TODO.md` readiness-facet gap)
- Modify: `frontend/src/dashboard.jsx` (new state `engAllocationFilter` beside `engProjectTrackFilter` :347; per-group snapshot :2727-2905; `getSelectionState` :6045; `isTechTask` callers :4134, :4159, :4502)
- Modify: `frontend/src/shareView/codec.js`, `viewDefaults.js`, `captureState.js`, `applyController.js`, `resolver.js`
- Test: `tests/test_work_structure_classification.js:132, :175`, `tests/test_eng_board_filters.js`, `tests/test_eng_alert_filters.js` (find existing alert filter test with `grep -rln matchesEpicFilters tests`), share-view codec tests (`grep -rln parseLanes tests`), `tests/ui/work_structure_one_lane.spec.js:75`

**Interfaces:**
- Consumes: `epicDetails[initKey].allocationClass` (Task 3), Board epic `projectClassification` (Task 4), `projectClassOf` (Task 5).
- Produces (DELIVERY only): the `projects` facet becomes label **Allocation**, counted per Initiative (dedupe by `fields.epicKey`, as `track`), options `[{id:'product',label:'Product'},{id:'tech',label:'Tech'}]`, `allowEmpty: true`, `showZeroCountOptions: true`, `emptyLabel: 'No Allocation'`, `emptyDescription` mirroring the Project Track copy, `emptyTotal` = Initiatives with class `none`, `neutralTotal` = Initiatives. `admitsAllocation(classId)` replaces `admitsProject(isTech)` for DELIVERY callers; neutral admits all, explicit `[]` admits only `none`. Legacy keeps the boolean `admitsProject` and `showTech`/`showProduct`.
- Alerts: `matchesEpicFilters` in DELIVERY uses `epic.projectClass` (Task 3) through `admitsAllocation`; Legacy unchanged.
- State: `engAllocationFilter` (`undefined` neutral | array) persisted like `engProjectTrackFilter`. Share key `alloc` (lead default 6); Board `bprojects` accepts `none` in DELIVERY.
- Positional view destructuring stays aligned (`[statusView, priorityView, projectsView, trackView]`; Board `[priorityView, projectsView, assigneeView, trackView]`).

- [ ] **Step 1: Tests.** `DELIVERY Allocation facet counts Initiatives and offers No Allocation`; `allocation facet empty selection admits only none`; `Legacy Projects facet unchanged`; Board `classifyEpicProjects treats none as No Allocation, not Tech`; alerts `DELIVERY Initiative alerts follow the Initiative class; Tech-only keeps Tech alerts`; codec `alloc=none round-trips to []`, `alloc omitted is neutral`, `Legacy links keep lanes`; UI `Allocation facet shows Product, Tech and No Allocation for the new model` + `allocation facet empty selection persists` (reload keeps "No Allocation only"); one-lane spec :75 updated label.
- [ ] **Step 2: Run** node tests → FAIL. **Step 3: Implement.** **Step 4: Run** node tests → PASS; build + `npx playwright test tests/ui/work_structure_one_lane.spec.js tests/ui/eng_group_board_view.spec.js --browser=chromium` → PASS; screenshot of the open facet popover checked against the Project Track popover (same component, same geometry).
- [ ] **Step 5: Commit** "Filter DELIVERY work by Initiative Allocation with a No Allocation state".

### Task 7: Stats show No Allocation

**Files:**
- Modify: `frontend/src/stats/statsUtils.js:162-175`, `frontend/src/stats/StatsTeamsView.jsx:108-178`, `frontend/src/stats/useStatsData.js:1342-1344`, `frontend/src/stats/excludedCapacityStats.js:469-477`, `frontend/src/stats/EffortTypeSplitChart.jsx:108,170`, `frontend/src/stats/projectTrackStats.js:46-49`, `frontend/src/analytics/events.js:32,91`
- Test: existing stats node tests (`grep -rln "buildLocalStatsFromTasks\|excludedCapacityStats" tests`), `tests/ui/work_structure_stats_epm.spec.js`

**Interfaces:**
- Produces (DELIVERY only): Stats Teams gets a "No Allocation" column; Effort Split gets a `none` series (label "No Allocation", analytics `series_type` token `no_allocation`); Project Track `capacitySide` filter keeps `product|tech|both` (No Allocation counted only under `both`). Stats Teams Product/Tech/No Allocation cells in DELIVERY render counts without project-based Jira links (closes the `docs/TODO.md` Stats-links gap; links would not match Allocation counts).

- [ ] **Step 1: Tests.** `DELIVERY team stats bucket none as No Allocation`; `Effort Split adds a no_allocation series for the new model only`; analytics allowlist accepts `no_allocation`; UI Stats Teams new-model column present, Legacy absent.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** "Show DELIVERY No Allocation work in Stats".

### Task 8: Docs, budgets, gates, close

**Files:** `docs/ontology.md` (:59-60 Sprint source; :69 Allocation precedence → Initiative only; date only touched sections' `Verified on`), `docs/README_ANALYTICS.md` (:114 `no_allocation`; :232 facet allowlist wording incl. "No Allocation"; :273 Allocation row), `docs/design-system.md` (Allocation facet reuses the facet empty state; split-bar third segment), SUPPORT design doc Allocation paragraph, `docs/TODO.md` (remove the items this plan closes: readiness facet, Stats links, refresh eligibility, issue-scan type, Initiative alerts, Ad Hoc mismatch; keep the rest), `docs/plans/DONE-delivery-allocation-split-and-sprint-scoping.md` (one Current Accuracy line pointing here), `scripts/extraction_lint/owner_budgets.json`, this plan.

- [ ] **Step 1:** `<PYENV> .venv/bin/python -m unittest tests.test_codebase_structure_budgets` and `node tests/test_dashboard_regrowth_guard.js`; re-sync only touched files' ceilings per root AGENTS.md section 11.
- [ ] **Step 2: Full gates:** `npm run build`; `<PYENV> .venv/bin/python -m unittest discover -s tests`; `npm run test:frontend:unit`; `npx playwright test tests/ui --browser=chromium --workers=4`. Read every summary line; a failure that passes alone is recorded as flake with the evidence.
- [ ] **Step 3:** Rename this plan to `DONE-…`, set Status/Outcome/Current Accuracy with the gate results and head commit, update `docs/plans/README.md` and links in the same commit.
- [ ] **Step 4: Commit** "Close the DELIVERY Initiative Allocation plan". Do not push: pushing needs the operator's go-ahead.

## Acceptance checklist

- [ ] No `observed_source` / `is_observed_supplement` / `board_inherited` in `backend/` or `tests/`; Board-mode configurations issue no Sprint scan JQL.
- [ ] Shared Board: each configuration lists, admits and offers in the Scope picker only its in-range Sprints.
- [ ] Refresh Sprint values covers a DELIVERY that inherits Legacy's Board.
- [ ] DELIVERY class comes only from the Initiative's own Allocation; no Objective batch, no Epic-level Allocation field on lane, excluded-capacity or Board child requests.
- [ ] `'none'` / "No Allocation" appears in the facet (Catch Up, Planning, Board), capacity totals, split bar, Initiative alerts, readiness rows and Stats for DELIVERY only.
- [ ] Ad Hoc in DELIVERY follows its Initiative class in facet and totals.
- [ ] Facet empty selection persists (reload, per-group snapshot, share link `alloc=none`).
- [ ] Legacy output unchanged (fixtures, Board frames, share `lanes`, Ad Hoc → Product).
- [ ] Docs, analytics, budgets updated; full gates recorded; plan renamed `DONE-`.

## Execution status

- **Task 1: done.** "Read Board-mode Sprints from the Board only, split by range". Divergences: the brief's `tests.test_work_structure_scope_selection` and `tests.test_eng_routes` modules do not exist; `tests.test_work_reader_routes`, `tests.test_oauth_eng_routes`, `tests.test_catalog_app_adapter`, `tests.test_workspace_catalog_config`, `tests.test_work_structure_routes` and the catalog/cache modules ran instead. `SelectorTests` now serves Sprint 201 from the Board, and the JQL-override test reads the Team query instead of the scan. Evidence: `tests.test_work_structure_catalogs` and `tests.test_work_structure_sprint_values` 45 OK (9 failed first); 435 related tests OK.
- **Task 2: done.** "Refresh Sprint values for a configuration that inherits its Board". No divergence: `refreshableSources` in `workConfigurationModel.js` replaces both `savedSourceReady` filters (hook and editor). Evidence: `tests/test_work_structure_settings.js` 30 pass (2 new failed first, `refreshableSources` undefined); `work_structure_scope_sprint_values.spec.js` 15 pass on Chromium (the new inherited-DELIVERY spec failed first with only `legacy` refreshed).
- **Task 3: done.** "Classify DELIVERY work by its Initiative's Allocation only". Divergences: `classify_allocation`, `stamp_epics`, `objective_keys_to_read` and `_resolve` stay (Board-only callers `eng_board._allocation_class` and `eng_board_routes._objective_allocations`), deleted with the Board in Task 4, so this commit leaves Board output unchanged; issue stamping is the new `stamp_issues(issues, classes)`; `allocation_stamps` stays in `jira_server.py` as the no-request helper that stamps `allocationClass` and returns issue classes; `fetch_epic_details_bulk` needed no change (it already reads the Initiative's Allocation); `story_readiness._PROJECT_CLASSES` accepts `none`; readiness tests live in `tests/test_story_readiness.py` (no `tests/test_eng_routes*.py` exists) and the existing DELIVERY readiness assertion moved from `other` to `none`; the fixture gained an `unmapped` pair and a `none` share on every pair; ontology Allocation entries updated. Evidence: 9 listed tests failed first (missing `classify_initiative`/`initiative_classes`, old stamps `tech`/`product`, lane field present, readiness `other`); 207 tests OK in the listed modules plus `tests.test_issue_edit_cache_generation tests.test_codebase_structure_budgets tests.test_eng_board_service`; full suite `discover -s tests` Ran 3438, OK (skipped=61).
- **Task 4: done.** "Carry the Initiative Allocation class on DELIVERY Board frames". `project_board` classifies each Board epic once with `classify_initiative` and, in DELIVERY, stamps `projectClassification` on the epic (index, candidate and column frames) and the same class on its children; `_allocation_class`, `_objective_allocations` (the Objective batch), the child Allocation field and the Board precedence helpers `classify_allocation`/`stamp_epics`/`objective_keys_to_read`/`_resolve` are deleted (`BoardPrecedenceTests` and `BoardObjectiveBatchTests` with them); `planning_work.resolve_allocation` stays. Divergences: the server writer takes `EngBoardStreamWriter(delivery=...)` (set from `_allocation_options(snapshot)`) so only a DELIVERY stream accepts the optional epic key and the child `none`; the client validator cannot see the model, so `engBoardApi.js` accepts the optional epic key (`product|tech|none`) and child `none` for every stream. `ENG_BOARD_PROTOCOL_VERSION` stays 1 (bumping it would change every Legacy frame; the key is additive and gated) and no Board cache keys frame shape. `dev_routes.py` needed no change: the measurement campaign projects without Allocation options, so it stays on the Legacy `product|tech|other` contract. The DELIVERY child-shape test replaced the old `test_delivery_children_classify_by_allocation_while_legacy_keeps_the_project_map`. Evidence: 8 new/rewritten Python tests and 3 node subtests failed first (missing epic key, `delivery` kwarg, children `product`, helpers present); `tests.test_allocation_classification tests.test_eng_board_service tests.test_eng_board_stream tests.test_work_reader_routes tests.test_eng_board_routes tests.test_eng_board_basic_compat tests.test_codebase_structure_budgets` Ran 181 OK; Node 20 `tests/test_eng_board*.js` 300 pass; three `tests/test_eng_board_progressive_loading.py` writer patches now forward the writer options; full suite `discover -s tests` Ran 3432, OK (skipped=61).
- **Task 5: done.** "Count DELIVERY No Allocation work as its own capacity bucket". `projectClassOf` returns the stamp (`product|tech|none`) or the Legacy project-key class; `classifyCapacityIssue` returns `none`/`none` for an unmapped stamp and keeps DELIVERY Ad Hoc on its stamped side (`capacityType: 'ad_hoc'`, `productSubtype` null off Product); unstamped (Legacy) Ad Hoc stays Product. Selection/excluded/team-project and Team capacity stats add `NONE`/`none` only for stamped `none` work (Legacy objects keep their keys, asserted); Team totals include it, `buildProjectCapacity`/`capacitySplit`/`capacityMultiplier` read only Product and Tech. `PlanningProjectSplitBar` draws `No Allocation` last (`project-bar-fill none`, `--muted` tint), Ad Hoc per side from the new hook output `selectedAdHocStats` (`buildSelectedAdHocStats`), and the target stays 70% of the whole bar. Divergences: `dashboard.jsx` passes `adHocStats` (the `adHocProductSP={selectedAdHocProductSP}` source guard is kept) and `tests/test_use_eng_capacity.js` freezes the new output; Tech/No Allocation Ad Hoc subsegments (`tech-adhoc`, `none-adhoc`, no ratchet hook needed) are children of their side's fill, start the side and paint beneath its label (z-index), and the Tech label carries no Ad Hoc suffix (tooltip "Incl. Ad Hoc"); fix round 1 ("Show No Allocation in the Planned Teams Effort table") adds a No Allocation column group between Tech and Total whenever the model is DELIVERY (cells show 0.0 for a Team without such work; no Jira links), via `CapacityNoAllocationCells.jsx` and a `data-allocation="delivery"` grid of 13 columns (Legacy markup unchanged, attribute absent); four groups exceed the desktop panel, so the existing wrapper scrolls horizontally to Total; the dashboard line ceiling rose 7503 -> 7508; Stats consumers of `classifyCapacityIssue` (Task 7) now see DELIVERY Ad Hoc on its side and `none` work outside the Product-side Project Track filter. No analytics event changes. Evidence: 9 node subtests failed first (missing `projectClassOf`, Ad Hoc forced Product, no `NONE`, hook output), and 5 Playwright cases failed against the old split bar; node `npm run test:frontend:unit` 3510 pass; `work_structure_one_lane.spec.js` 17 pass and the new `work_structure_capacity_allocation.spec.js` 2 pass on Chromium (the DELIVERY table case and the 100% Ad Hoc Tech label `elementFromPoint` guard failed first); `tests.test_codebase_structure_budgets tests.test_work_structure_reference_fixture tests.test_dashboard_css_extraction` 32 OK.
- **Task 6: done.** "Filter DELIVERY work by Initiative Allocation with a No Allocation state". In DELIVERY the `projects` facet (Catch Up/Planning and Board) is Allocation: options Product/Tech, `allowEmpty`, `showZeroCountOptions`, empty label No Allocation, counted per Initiative (`allocationClassOf`: the Initiative's `allocationClass`, else the item's stamp or `projectClass`, else `none`; the Board reads the epic's own `projectClassification`/`allocationClass`, never its children); `admitsAllocation` admits all when neutral and only `none` when empty; Legacy keeps `admitsProject`, `showTech`/`showProduct` and its facet unchanged. `classifyEpicProjects` reports `none` as `isNone`, not Tech. Alerts use the new pure `admitsAlertEpicProject`; DELIVERY readiness rows accept `none` (and the earlier `other`) and are filtered by `admitsAllocation`. State `engAllocationFilter` is reset by Clear, captured in the per-group snapshot and `getSelectionState`, and links as `alloc` (`none` = []; omitted = neutral, applied in the facet stage) with Board `bprojects=none`; Legacy links keep `lanes`. Divergences: `engProjectTrackFilter` is not in the UI prefs, so "persisted like it" could not survive a reload (Review Focus 2); `engAllocationFilter` is also saved in the UI prefs (like `showTech`/`showProduct`, which it replaces in DELIVERY) and seeds a new group's default. In DELIVERY the capacity hook gets `showProduct`/`showTech` as true, so the Allocation facet, like Project Track, does not scale capacity and a stale Legacy boolean cannot zero a side; the brief's alert test file is `tests/test_eng_alert_search.js` (no `test_eng_alert_filters.js` exists); the dashboard `useState` hook ceiling rose 121 -> 122 (`tests/test_dashboard_regrowth_guard.js`), the line ceiling held at 7508. Evidence: 24 node tests failed first (missing Allocation facet, `admitsAlertEpicProject`, `alloc` key, `isNone`); `npm run test:frontend:unit` 3520 pass; the new `work_structure_allocation_facet.spec.js` (3) and the one-lane label case failed first against the reverted sources; Chromium `work_structure_one_lane`, `eng_group_board_view`, `work_structure_allocation_facet`, `shareable_view_links`, `eng_group_board_filters` and `eng_compact_layout_visual` 380 pass; `tests.test_codebase_structure_budgets tests.test_share_view_stash tests.test_dashboard_css_extraction` 47 OK.
- **Task 7: done.** "Show DELIVERY No Allocation work in Stats". `buildLocalStatsFromTasks` buckets `projectType: 'none'` as `projects.none` (summary and every team) and `buildEffortTypeSplitRows` routes `capacityType: 'none'` to `nonePoints` with a last `segments.none` ("No Allocation"); both add the bucket only when the input is Allocation-stamped (`projectStamp`, now exported from `capacityClassification.mjs`), so Legacy objects keep their keys. Team rows gain `none`/`weightedNone` when the team carries the bucket. `StatsTeamsView` and `EffortTypeSplitChart` take `noAllocation` from `StatsPanel`'s model (`isCombinedWorkModel(workScope.model)`): the Teams table adds a No Allocation group after Tech (`stats-col none`, neutral tint) and renders Product/Tech/No Allocation counts without Jira links (Total keeps its links); the chart adds a `none` legend button and segment drawn last in the "No track" grey `#94a3b8`, analytics `series_type` token `no_allocation`. Divergences: `projectTrackStats.js` needed no change (`inScope` already admits `none` only under `both`, now pinned by a test); `frontend/src/analytics/events.js` needed no change (`series_type` has no value allowlist; `no_allocation` passes the safe-token rule, pinned in `tests/test_analytics_events.js`); `statsTotals` gained no `none` (no consumer); at 1280px the 17-column DELIVERY table exceeds the panel, so it sits in a `[data-allocation="delivery"]` frame that scrolls horizontally (Legacy markup has no frame); the summary cards (Product total, Tech share) are unchanged and do not show a No Allocation share. Evidence: 6 node tests failed first (missing `projects.none`, `nonePoints`, column, series, token); `npm run test:frontend:unit` 3526 pass; Chromium `work_structure_stats_epm.spec.js` 8 pass (3 new: DELIVERY Teams column with element geometry and scroll, Legacy unchanged, Effort Split series with `elementFromPoint`, readout and Legacy switch), plus `adhoc_capacity_visual_proof`, `design_system_hover_surfaces`, `codebase_structure_smoke`, `dashboard_data_freshness` 178 pass; `tests.test_codebase_structure_budgets tests.test_dashboard_css_extraction` 21 OK.
- **Task 8 (docs and budgets, Step 1 only): done.** "Document DELIVERY Initiative Allocation and Board-only Sprints". Docs describe the shipped behaviour: ontology (Scope picker Sprint values from one source, split by range only for a shared Board; Ad Hoc follows its Initiative in DELIVERY; Stats No Allocation; Board and readiness tests in the Allocation entry; Coverage line and `Verified on` dates unchanged, the section was already dated 2026-11-09), `README_ANALYTICS.md` (`series_type` `no_allocation`, No Allocation in the facet allowlist row, the Allocation row covers the facet, Stats columns and the `alloc`/`bprojects=none` link keys), `design-system.md` (one element-map row for the DELIVERY No Allocation modifiers and `data-allocation` hooks, not registry hooks), the SUPPORT design Allocation paragraph, `docs/TODO.md` (closed items removed; follow-ups added) and one Current Accuracy line in the DONE plan. Divergences: the extraction lint ran here with the parent checkout's pinned `tmp/lint` tooling; at the plan base (`e4bc1f41`) it reported 70 enforced problems and at `439b0cf6` 79; `owner_budgets.json` re-synced only the plan-touched interfaces (`useEngCapacity` digest, `selectedAdHocStats` return and reader, counts re-measured after dropping the stale `workModel`/`selectedPlanningTasksList.reduce` members; `useStatsDerivedC`, `StatsPanel` and `useWorkConfigurationSettings` digests after reviewing their diffs), leaving 66, all present at the base; ESLint 107 warnings at both. Orphan imports removed from `tests/test_work_structure_catalogs.py` (`replace`, `time`, `load_scoped_sprint_catalog`) and `tests/test_work_structure_sprint_values.py` (`DELIVERY_SPRINT_FIELD`). Full gates and the `DONE-` rename are not part of this step. Evidence: `tests.test_codebase_structure_budgets`, `tests.test_work_structure_catalogs`, `tests.test_work_structure_sprint_values`, `tests.test_agents_md_learnings` OK; `tests/test_dashboard_regrowth_guard.js` pass.
