# DELIVERY Allocation split and per-configuration Sprint scoping

> **Status:** Done. Executed on branch `feature/quarterly-allocation-split-sprint-scoping` (Tracks A and B, A3b and Track C steps 1-3, 2026-11-09); kept for audit context only. Review fixes and the full gate run (Track C step 4) are at head `8684da3e`.

> **Current accuracy, 2026-11-10:** Allocation value selection and Product/Tech mapping now belong to each shared Department, initialized empty by operator decision. Project config retains the Jira field mapping and dormant old value-map history. DELIVERY Board uses distinct `scope=allocation`; Legacy keeps `component`. See [Department Allocation contract](DONE-department-allocation-board-scope.md); the historical Project-level mapping steps below are superseded.

## Outcome

Implemented with changes. DELIVERY splits Product/Tech by its mapped Allocation (server stamp `projectClassification`, client split, one `project=all` lane request), Settings maps Allocation values with the Legacy project picker's controls, each configuration takes its Sprint ids only from its own sources, and same-named Scope Sprint values show as `<name> - legacy` / `<name> - delivery` rows. The divergences are recorded in each task's Status line. Two behaviour changes follow from them and are intended:

- An inherited-Board DELIVERY entry with no scan source (no projects or no Sprint field) is `setup_required` instead of `ready` (Task B2, B3).
- A DELIVERY quarter that no Epic carries yet shows no Sprint until the scan sees one: an inherited Board contributes no DELIVERY Sprint row (Q1, literal reading, Task B2).

Final review (2026-11-09) fixes: the `purpose=alerts` tasks request no longer requests Allocation or reads Objectives (it keeps only outcomes, so it doubled the fan-out); the excluded-capacity summary cache default carries `allocation: None` so an unreadable Initiative is a cache hit; unpromoted Sprint-value rows keep `configurationIds: []`; `GET /api/work-structure/allocation-options` answers `409 configuration_feature_disabled` with the flag off on an unpromoted workspace. Left open (in `docs/TODO.md`): in DELIVERY the Product/Tech facet does not filter story-readiness requirement rows (`engWorkHierarchy.js` `requirementVisible` keeps its combined guard), and the Stats Teams Product/Tech cells still link to project-based Jira searches.

External review fixes (2026-11-09, PR 334): only a DELIVERY entry with a blank stored Board is `board_inherited` (Legacy borrowing DELIVERY's Board keeps Board-only discovery instead of `setup_required`); a completion poll for an inherited Board with no scan answers `409 catalog_identity_changed` (the re-list shows `setup_required`) instead of reading Board rows; a malformed Objective batch on the Board leaves its Objectives unread (Product) instead of failing the Board, and only `AuthError` propagates; `GET /api/work-structure/allocation-options` answers `409 configuration_feature_disabled` whenever the flag is off (promoted too), returns `401 auth_required` on an expired Jira sign-in from either source, and falls back to autocomplete when createmeta lists no values or its call fails. Review findings left as decisions or backlog are in `docs/TODO.md`.

## Current Accuracy

Partially accurate: the goal, owner decisions, assumptions and acceptance checklist describe what shipped; the task bodies are the pre-execution contract, and where a task's Status line records a divergence the implementation is the source of truth. The extraction lint is still red with the same 70 enforced problems as the merge base (none added here); see Track C step 1.

Superseded in part by [DONE-delivery-initiative-allocation-and-board-sprints.md](DONE-delivery-initiative-allocation-and-board-sprints.md): DELIVERY Product/Tech now comes from the Initiative's own Allocation only, with a third class No Allocation (no Epic/Objective precedence, no Objective batch, Ad Hoc follows its Initiative), and Board-mode Sprints come only from the Board, split by quarter range (the issue-scan supplement is deleted); where they differ, that plan and the implementation are the source of truth.

**Goal:** In the DELIVERY (`rnd_2027`) configuration, the Allocation field decides Product vs Tech (instead of one combined lane), mapped in Settings with the Legacy project picker's controls. Each configuration takes its Sprint ids only from its own sources, and same-named Sprints from both configurations show as two labelled rows wherever they share a list.

**Supersedes:** decisions D-D, D-E and the open D-C clarification in [DONE-quarterly-work-structure-migration.md](DONE-quarterly-work-structure-migration.md) (lines 424-426, 441-443, 453-454, 470). The work stays behind `WORK_CONFIGURATIONS_ENABLED`, and only DB/OAuth is supported, as in that plan.

## Owner decisions (2026-11-09, fixed)

1. In DELIVERY, Allocation decides Product vs Tech. Legacy is unchanged: it still classifies by Jira project (`selectedProjects [{key,type}]`, the picker in `frontend/src/settings/JiraFieldSettings.jsx:306-395`). DELIVERY uses the same selection logic and UI pattern, applied to Allocation values instead of projects.
2. The Settings label `RnD_allocation_category` becomes `Allocation` (`frontend/src/settings/workConfigurationFormProps.js:229`). The stored key `fields.allocation` does not change.
3. The mapping lives in Settings inside the DELIVERY configuration and is stored in the bundle as `allocationTypes: [{value, type: 'product'|'tech'}]`. A mapping change must change the configuration digest.

## Assumptions (lead defaults, owner silent; change here before execution if wrong)

- **A1 Precedence.** Allocation is resolved per DELIVERY Epic with `resolve_allocation`'s order (`backend/services/planning_work.py:687-716`): Epic, then Initiative, then Objective. A blank Epic whose Initiative is unreadable resolves as `unavailable`. Jira option objects `{value}` are normalized to their `value` string, and matching against the mapping is exact after trimming. That is the only normalization; values are not casefolded.
- **A2 Default.** An unmapped, blank (`none`) or `unavailable` Allocation counts as **Product**. This matches the Legacy default type (`_projects` default `product`, `backend/services/work_structure.py:300`).
- **A3 Ad Hoc.** Ad Hoc still takes precedence over Tech (`frontend/src/capacityClassification.mjs:8-9`). In DELIVERY it is keyed on the Initiative, because `fields.epicKey` holds the Initiative key.
- **A4 One request.** DELIVERY keeps exactly one `project=all` lane request (`frontend/src/eng/useEngSprintData.js:145-155`). The server stamps each task with `fields.projectClassification: 'product'|'tech'`, and Board children reuse their existing `projectClassification`. The frontend splits on the client, so there are never two DELIVERY lane requests. Legacy keeps its two project-based requests: per MRT010 (`docs/postmortem/MRT010-startup-api-load-fanout-and-overscoped-payloads.md`) the fetches are not unified.
- **A5 Surfaces to un-hide** in DELIVERY: the Projects facet (`engCatchUpFilters.js:124`, `engBoardFilters.js:73`), `PlanningProjectSplitBar` with its 70/30 target (`PlanningProjectSplitBar.jsx:11`), capacity buckets (`useEngCapacity.js:71`, `planningCapacityUtils.js:386,436`, `planningSelectionStats.js:67,89`), Board classification (`backend/services/eng_board.py:1076`), the stats classifiers (`statsUtils.js:162`, `projectTrackStats.js:46`, `excludedCapacityStats.js:469`) and Planned Teams Effort. Every other `isCombinedWorkModel` guard stays: those guards are about the entity shift and retired alerts, not Product/Tech (`epicRefreshAlerts.js:153,162`, `useEngAlerts.js:30`, `EngAlertsPanel.jsx:127`, `planningReviewKinds.js:18,26`, `scenarioUtils.js:182`, `useTeamGroupSettings.js:942`, `engWorkHierarchy.js:282`, `EpicBlock.jsx:395`, `EngBoardEpicPanel.jsx:271`, `dashboard.jsx:590,3940-3942,5237`). The retired Backlog request stays retired.
- **A6 Project access** (`backend/auth/project_access.py`) stays project-based. `fetch_tasks` gates `product|tech` only for Legacy (`jira_server.py:3600`). DELIVERY's `project=all` request is not gated by Allocation, and Allocation never grants or denies access.
- **A7 Sprints (D-C).** Each configuration takes Sprint ids only from its own sources inside its own quarter range, and ranges stay contiguous and non-overlapping (`normalize_work_configurations`, `work_structure.py:447-449`). When DELIVERY's Board is **inherited**, which happens when its stored `boardId` is blank (`inherit_board`, `work_structure.py:623-638`), DELIVERY's Sprint rows come **only** from its own issue scan (`observed_source`, `backend/services/workspace_catalog_config.py:436-452`). The inherited Board still satisfies "Board required" (`entry_missing_fields`). A DELIVERY entry with its **own** Board keeps today's Board-wins tie rule.
- **A8 Suffix.** Where a list mixes both configurations' Sprints and the same name appears in both, each shows as its own row labelled `<name> - legacy` or `<name> - delivery`. The suffix lives in a display-only `label` field. It must never reach a Sprint `name`, `admit_sprint_source`'s name check (`backend/routes/work_structure_routes.py:279`), the story readiness name check, `parse_quarter`, a saved `sprintName` or a share link (share links carry ids).
- **A9 Digest.** `allocationTypes` is a new top-level key on the DELIVERY entry. It is not under `scope`, because `scope` feeds `source_digest` (`work_structure.py:840-853`) and a mapping change must not retire the Sprint catalogs. Because `_entry_digest` hashes every key except `name` (`work_structure.py:611-614`), the configuration digest changes on every mapping edit. Every stored DELIVERY digest also changes once when the key first appears (`[]`). This is accepted because the feature flag is off by default; open tabs recover through the existing `configuration_scope_changed` re-read (`dashboard.jsx:592-597`).

## Conflicts between the defaults and the code (resolved here; reopen only with new evidence)

- **C1 Objective fallback costs one more Jira batch.** `fetch_tasks` has the Initiative only through `fetch_epic_details_bulk` (`jira_server.py:2991-3071`). The issue's embedded `parent` holds no custom fields, so it cannot carry an Objective's Allocation. `load_planning_work` and `resolve_allocation` have no production caller (DONE plan line 442). This plan adds the Allocation field to the Initiative batch, then makes one batched `issueKey in (...)` read of the distinct Objective keys, only for Initiatives whose Allocation is blank. The read uses batches of 40, like `fetch_epic_details_bulk`, and stops after `ceil(objectives/40)` requests. A failed batch makes those Epics `unavailable`, which counts as Product under A2. The frontend still sends one lane request.
- **C2 Stats endpoints are separate, configuration-admitted reads.** Stats classification runs in the browser over issues returned by `/api/stats/excluded-capacity-source` (`jira_server.py:6523`, `roles=work_request.roles`), `/api/stats` (`:6603`) and `/api/stats/epic-cohort` (`:6793`), not only over Catch Up tasks. Each endpoint that returns DELIVERY planning issues to `classifyCapacityIssue` must carry the same stamp. Task A3 lists the endpoints that do. An endpoint that returns no classifiable issue is left alone.
- **C3 There is no same-name collision in the header Sprint selector.** `_configuration_source_result` filters each configuration's rows with `in_range_sprints` (`backend/services/workspace_catalog_cache.py:272-287`), and a non-quarter name is never in range. So the merged header list (`settings_routes.py:1028-1031`) cannot hold one name twice. The suffix therefore applies only to the range-agnostic Scope picker (`collect_sprint_values`, `work_structure_routes.py:414-461`, consumed through `sprintValueOptions`, `frontend/src/settings/workConfigurationModel.js:39-50`). Task B3 pins the merged list's uniqueness with a test and adds no suffix code there.
- **C4 The Scope picker cannot honour "within its own range".** The picker exists to choose range boundaries, so it is range-agnostic by design (`collect_sprint_values` docstring). Its rows are scoped by **source** under A7 (an inherited Board contributes no DELIVERY row), not by range.
- **C5 Option values are not always readable.** Field-context options (`/rest/api/3/field/{id}/context/{ctx}/option`) need Administer Jira, and the OAuth scopes (`backend/auth/jira_auth.py:38`) grant no `manage:jira-configuration`. The source is chosen in Task A2.

## Open question (does not block; default applied)

- **Q1 (A7).** For an inherited Board, this plan treats "must not take Legacy's Board Sprint ids" literally: the DELIVERY rows come only from the scan. A quarter that no DELIVERY Epic carries yet therefore shows no Sprint until the scan sees one, which is the existing scoped-issues behaviour. The softer reading keeps Board-only names until the scan has them. It was rejected because a selection would later switch from id A to id B and stale links and caches (`sprint_catalog_mismatch` 409). Confirm the literal reading before Task B2 lands.

## File map (every path verified 2026-11-09; **Create** marks new files)

| Path | Track | Change |
| --- | --- | --- |
| `backend/services/work_structure.py` | A | `_normalize_entry`: `allocationTypes` (rnd only), validation, `_context_for`/`WorkConfigurationContext` carry it, save keeps stored value when the key is absent |
| `backend/services/allocation_classification.py` | A | **Create**: pure `allocation_value(raw)`, `classify_allocation(state, value, allocation_types)`, `stamp_epics(...)` |
| `jira_server.py` | A | `fetch_epic_details_bulk` adds the Allocation field for rnd roles; `fetch_tasks` slim payload stamps `projectClassification`; Objective batch (C1); stats endpoints (C2) |
| `backend/routes/eng_board_routes.py`, `backend/services/eng_board.py` | A | Allocation in `epic_fields`/`child_fields` (`eng_board_routes.py:802,909`), cache/scope version material (`:477-479,517-519`), `project_board` classifies rnd children by Allocation (`eng_board.py:1076`) |
| `backend/routes/work_structure_routes.py` | **shared**: A appends the new route at file end; B owns `admit_sprint_source` (245-287) and `collect_sprint_values` (414-461) | A: `GET /api/work-structure/allocation-options`; B: source scoping and suffix rows |
| `backend/security/policy.py` | A | `EndpointPolicy("work-structure-allocation-options-read", ..., "authenticated_read")` beside line 108 |
| `frontend/src/capacityClassification.mjs` | A | Remove the combined `other` branch (27-38); stamp-first `isTechIssue`; Ad Hoc still wins |
| `frontend/src/dashboard.jsx` | A | `isTechTask` (4092-4095) delegates to `isTechIssue` |
| `frontend/src/eng/engCatchUpFilters.js`, `engBoardFilters.js`, `useEngCapacity.js`, `planningCapacityUtils.js`, `planningSelectionStats.js`, `PlanningProjectSplitBar.jsx` | A | Drop Product/Tech `combinedLane` branches; delete `CombinedWorkBar` (`PlanningProjectSplitBar.jsx:90`), orphaned by this change |
| `frontend/src/stats/statsUtils.js`, `projectTrackStats.js`, `excludedCapacityStats.js` | A | No code change expected: they already call `classifyCapacityIssue`. Verify only |
| `frontend/src/settings/workConfigurationFormProps.js` | A | Label `Allocation`; `classificationMode` unchanged for projects; allocation picker props |
| `frontend/src/settings/JiraFieldSettings.jsx` | A | Allocation Product/Tech picker reusing the project picker markup and classes |
| `frontend/src/settings/WorkConfigurationsEditor.jsx` | **shared**: A owns the search hook (≈40-55); B owns `SprintRanges` (59-120) | A: allocation-options request; B: option id/label |
| `frontend/src/api/jiraCatalogApi.js` | A | `searchAllocationOptions` beside `searchProjects` (imported at `WorkConfigurationsEditor.jsx:3`) |
| `backend/services/workspace_catalog_config.py` | B | `EffectiveCatalogConfig.board_inherited`, set in `resolve_catalog_sources` from the stored entry |
| `backend/routes/settings_routes.py` | B | `_configuration_source_result` (883-951): inherited Board → scan rows only |
| `frontend/src/settings/workConfigurationModel.js` | B | `sprintValueOptions`: unique option `id`, display `label`, select patches bare `value` |
| Tests, see each task | A/B | |
| `scripts/extraction_lint/owner_budgets.json` | C | Re-sync ceilings and digests for touched registered files: `dashboard.jsx`, `JiraFieldSettings.jsx`, `workConfigurationFormProps.js`, `WorkConfigurationsEditor.jsx`, `useEngCapacity.js`, `workConfigurationModel.js` (and `useWorkConfigurationSettings.js` if touched) |
| `docs/plans/DONE-quarterly-work-structure-migration.md`, `docs/plans/SUPPORT-quarterly-project-configurations-design.md:153-155`, `docs/TODO.md:76`, `docs/ontology.md:69`, `docs/README_ANALYTICS.md`, `docs/design-system.md` (rows 21-22, only if a hook changes) | C | Docs |

Track C is the integration owner (the lead). It owns every shared doc, the budgets file and the full gates, and it runs after both tracks merge.

## Tests that encode the old behaviour and are rewritten on purpose

- `tests/test_work_structure_classification.js`: tests at lines 33 ("combined model never says Product/Tech"), 94 (`other` buckets), 118 (hidden Projects facet). Lines 209 and 220 (one `project=all` request, no Backlog) **stay** as written.
- `tests/ui/work_structure_one_lane.spec.js`: tests at lines 75, 87 and 106 (hidden facet; no Product/Tech label or 70/30 marker). Line 42 (one request) and line 127 (retired alerts) **stay**.
- `tests/fixtures/work_structure_reference.py:116-128` (`NEW_MODEL_EXPECTED_PAIRS`, `NEW_MODEL_CLASSIFICATION_EXPECTED`) and their pins in `tests/test_work_structure_reference_fixture.py:139-143`.
- `tests/test_work_structure_catalogs.py` `ObservedOnBoardConfigurationTests` (493-593): line 543 (Board wins a tie) is split into an own-Board case (unchanged) and an inherited-Board case (scan only). Lines 551 and 574 gain inherited-Board counterparts.
- `tests/test_work_structure_sprint_values.py:55` (one row per name) becomes one row per name and configuration when a name appears in both.
- Board fixtures that assert `projectClassification: 'other'` for DELIVERY children (`tests/ui/eng_group_board_view.spec.js:351,632,5957`, `tests/test_eng_board_view_model.js:78,97`, `tests/test_eng_epic_story_points.js:37`). Check each one's model. Rewrite only the rnd fixtures; Legacy `other` (unmapped project) stays valid.

## Track A — Allocation split and Settings mapping

### Task A1: Bundle contract

1. Failing tests first, in `tests/test_work_structure.py` (the existing `normalize_work_configurations` tests):
   - DELIVERY with `allocationTypes: [{value:'Growth',type:'tech'}]` round-trips.
   - Legacy with the key → `invalid_configuration` at `configurations[0].allocationTypes`.
   - Type not in `product|tech` → invalid. Blank value → invalid. A value over 255 characters → invalid. More than 200 entries → invalid.
   - Duplicate values (exact after trim) keep the first.
   - Stored bundle without the key normalizes to `[]`.
   - `entry_digest` differs when one mapping type flips. `source_digest` is unchanged.
   - A save whose incoming DELIVERY entry **omits** the key keeps the stored mapping, while an explicit `[]` clears it. This protects against a stale browser bundle.
   - `WorkConfigurationContext.to_dict()` includes `allocationTypes`.
2. Implement in `_normalize_entry` (`work_structure.py:357-419`). Add `allocationTypes` to `allowed` for rnd only, keep it optional, and add a `_allocation_types` validator modelled on `_projects` (297-317). Carry it through `_blank_delivery` (465-472), `_context_for` (667-673) and the dataclass (`:587-607`). Do the absent-key preservation in the save path (`_save_later`, 1024-1058) by checking the raw incoming entry before normalization.
3. Verify: `.venv/bin/python -m unittest tests.test_work_structure` and `.venv/bin/python -m unittest tests.test_planning_work_profiles`.

Status: done in fd041782; divergences: the absent-key preservation is decided in `save_work_configurations` from the raw incoming bundle and applied in `_save_later` (first save has no stored mapping); save tests patch `update_workspace_config_keys` instead of using Postgres.

### Task A2: Allocation option values (Settings source)

Source choice (C5): the **primary** source is `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes/{planningIssueTypeId}`, reading the Allocation field's `allowedValues[].value`. It returns the complete list under user OAuth `read:jira-work`, but needs the user's Create permission in the DELIVERY project. The **fallback**, used on a non-200 response or a field missing from createmeta, is `GET /rest/api/3/jql/autocompletedata/suggestions?fieldName=cf[<n>]&fieldValue=<query>`, the same user-level call as labels (`settings_routes.py:1906-1919`). It is prefix-only and capped at about 15, so the response reports `complete:false`. When both fail, the UI accepts a typed value, following the `typedSprintOption` precedent (`workConfigurationModel.js:55-59`). Field-context options are rejected (C5).

1. Failing tests first, in a new `tests/test_work_structure_allocation_options.py` (**Create**), with `current_jira_get` patched:
   - createmeta success → `{options:[{value}], source:'createmeta', complete:true}`.
   - createmeta 403 → autocomplete with quotes stripped → `complete:false`.
   - Both fail → `{options:[], source:null, complete:false}` with 200 and no raw Jira error.
   - `fieldId` not matching `customfield_\d+`, a bad project key or a non-numeric issue type → 400.
   - Unauthenticated → the existing 401 contract.
   - The policy inventory test (`tests/test_endpoint_policy_inventory.py`) passes with the new row.
2. Implement the route at the end of `backend/routes/work_structure_routes.py`. It is `GET /api/work-structure/allocation-options?fieldId&projectKey&issueTypeId&query`. The params come from the **draft**, so an unsaved field choice is listable; the read uses the user's own Jira under OAuth, with no workspace data and no write. Add the policy row in `backend/security/policy.py`.
3. Verify: `.venv/bin/python -m unittest tests.test_work_structure_allocation_options tests.test_endpoint_policy_inventory`.

Status: done in e4ea6194; divergences: `projectKey` and `issueTypeId` are optional (without both, only autocomplete runs); createmeta is read as one page of `maxResults=200`, and a field missing from that page falls back to autocomplete; the `query` filters createmeta values by case-insensitive substring; a 400 uses `invalid_allocation_options_request`.

### Task A3: Server stamp

1. Failing tests first:
   - `tests/test_allocation_classification.py` (**Create**) for the pure module:
     - `{value:'X'}` → `'X'`.
     - A mapped Tech value → `tech`, a mapped Product value → `product`.
     - Unmapped, `none` and `unavailable` → `product` (A2).
     - A blank Epic over a Tech Initiative → `tech`.
     - A blank Epic and blank Initiative over a Tech Objective → `tech`.
     - A blank Epic over an unreadable Initiative → `product`.
     The precedence must match `resolve_allocation`, so the module reuses the existing cases in `tests/test_planning_work_profiles.py:300-312` as an oracle.
   - A `fetch_tasks` test in `tests/test_work_reader_routes.py` (the existing promoted `/api/tasks` reader tests): an rnd context sends the Allocation field in the epic batch, emits `fields.projectClassification`, makes exactly one Objective batch when only an Objective holds the value, and makes zero Objective batches when every Initiative is set. A Legacy request is byte-identical, with no `projectClassification`.
   - The Board: `tests/test_eng_board_service.py` gains an rnd case where `project_board` children read Allocation (Tech) while the Legacy project map is unchanged (`:413-418` stay). `tests/test_eng_board_stream.py` checks that the scope/cache version changes with `allocationTypes`.
   - Stats: for each endpoint in C2 that returns planning issues for rnd, assert the stamp is present. Inventory with `rg -n "classifyCapacityIssue|isTechTask" frontend/src` and trace each list to its endpoint; record the list in this task before coding.
   - Inventory (recorded 2026-11-09 from `rg -n "classifyCapacityIssue|isTechTask" frontend/src`): `statsUtils.js:162` (`buildLocalStatsFromTasks`), `planningCapacityUtils.js`, `planningSelectionStats.js`, `useEngCapacity.js`, `engCatchUpFilters.js` and the Board facet read Catch Up tasks from `/api/tasks-with-team-name` (`fetch_tasks`); `projectTrackStats.js:46` and `excludedCapacityStats.js:469` read `excludedCapacityIssues` from `/api/stats/excluded-capacity-source`. `/api/stats`, `/api/stats/burnout`, `/api/stats/epic-cohort` and `/api/stats/project-track-phase-durations` return nothing that reaches `classifyCapacityIssue`, so only `fetch_tasks` and the excluded-capacity source are stamped.
2. Implement. The pure module carries no Flask and no I/O. Wire it in `fetch_epic_details_bulk` (add `roles.allocation_field_id` to `fields` only when `not roles.is_legacy`, and store the raw value as `epic_details[key]['allocation']`). The stamp goes in the slim payload (`jira_server.py:3984-4000`). The Objective batch follows C1. The Board passes `allocation_types` and the field id through the snapshot.
3. Verify: `.venv/bin/python -m unittest tests.test_allocation_classification tests.test_eng_board_service tests.test_eng_board_stream tests.test_planning_work_profiles tests.test_work_reader_routes`.

Status: done in 5c7cddec; divergences: `epic_details[key]['allocation']` holds the normalized value string, not the raw option; the Objective is the Initiative's typed ancestor (`epic_details[...]['initiative']`), so an Initiative parent of another type counts as no Objective; the excluded-capacity source also reads each Initiative's Allocation and typed parent in its existing summary batch and is stamped (`tests/test_work_structure_stats.py`); the stats stamp test lives there, not in `test_work_reader_routes.py`. **Gap:** the Board reads no Objective, so a blank Epic under a blank Initiative that has a parent is `unavailable` (Product) on the Board even when the Objective is Tech; Catch Up, Planning and Stats do read it. No Board cache/scope change was needed: the cohort already carries the configuration digest, which covers `allocationTypes` (pinned in `tests/test_eng_board_stream.py`).

Follow-up A3b: done in 9069ee50; closes the Board gap above. After the index phase the Board reads the typed Objectives (`ancestorIssueTypeId`) of blank Initiatives through `allocation_classification.objective_keys_to_read`, in batches of 40 via the Board's own search transport, and `project_board` takes them as `allocation_objectives`. Divergences: the read is gated on blank Initiatives, not on blank Epics, because the Board knows its Epics only after the child phase (so a blank Initiative whose Epics all carry a value still costs its Objective's batch share, within `ceil(objectives/40)`); a failed batch is skipped (Product), never a Board error; the stream test lives in `tests/test_work_reader_routes.py` `ComponentBoardStreamTests`, where the DELIVERY Board fixture is.

### Task A4: Frontend split

1. Failing tests first (rewrite the list above):
   - `tests/test_work_structure_classification.js`: an rnd task with `projectClassification:'tech'` → `tech/tech/null`, one with `'product'` or no stamp → `product/product/standard`, and an Ad Hoc Initiative over a Tech stamp → `product/ad_hoc/ad_hoc`.
   - The Catch Up and Board facet models count Product/Tech for rnd.
   - `buildSelectedProjectStats` returns PRODUCT/TECH for rnd and never OTHER.
   - Project capacity uses the 70/30 split for rnd.
   - The one-request tests stay green.
   - Fixture pairs updated (`work_structure_reference.py:116-128`).
2. Implement. In `capacityClassification.mjs`, delete the combined branch. After Ad Hoc, a stamp `fields.projectClassification` or `issue.projectClassification` of `product|tech` decides, otherwise project keys decide. Export `isTechIssue(task, techProjectKeys)` and have `dashboard.jsx` `isTechTask` call it. Remove the `combinedLane` Product/Tech branches listed in A5, keeping every other guard. Delete `CombinedWorkBar`, and keep the `workModel` props only where another guard still reads them.
3. Verify: `npm run build && node --test tests/test_work_structure_classification.js tests/test_eng_board_filters.js tests/test_eng_board_card_model.js tests/test_eng_board_view_model.js`.

Status: done in fa9fdc5c; divergences: the combined-lane `workModel` parameters of `buildSelectedProjectStats`, `buildSelectedTeamProjectStats`, `buildExcludedProjectStats`, `buildProjectCapacity`, `buildTeamCapacityStats`, `classifyCapacityIssue` and `useEngCapacity` were removed (no remaining reader), with the orphaned `other`/`OTHER` handling in `buildTeamCapacityEntries` and `buildSelectedProjectEntries`; `buildExcludedProjectStats` now uses `isTechIssue`. Also rewritten on purpose (not in the list above): `tests/test_capacity_classification.js` (combined other/other), `tests/test_planning_selection_stats.js` (one OTHER lane), `tests/test_catch_up_entity_names.js` (hidden DELIVERY facet), `tests/test_excluded_capacity_stats_source_guards.js` (call signatures). The Board fixtures in `eng_group_board_view.spec.js`, `test_eng_board_view_model.js` and `test_eng_epic_story_points.js` are Legacy-shaped (Bug children, unmapped project) and stay. `work_structure_one_lane.spec.js` 75/87/106 rewritten (facet shown, Product/Tech split with the 70/30 marker).

### Task A5: Settings mapping UI and label

1. Failing tests first:
   - Extend `tests/ui/work_structure_settings.spec.js`. The DELIVERY Field mapping row is labelled `Allocation`, not `RnD_allocation_category`.
   - The DELIVERY Scope tab shows Product and Tech subsections listing Allocation values. Use synthetic values (`Growth`, `Platform`) from a mocked `/api/work-structure/allocation-options`.
   - Search, then `Product`/`Tech` buttons (`project-type-btn`), add a chip (`selected-team-chip product-chip|tech-chip`).
   - `remove-btn` removes the chip. The footer Save posts `allocationTypes` and nothing else changes.
   - Legacy shows no Allocation picker.
   - `complete:false` shows the existing `group-field-helper` text that typed values are allowed.
   - Element-level checks: each chip and button carries its shared class, and there is no new class.
2. Implement in `JiraFieldSettings.jsx`. Reuse the scope-pane markup (306-395) for an "Allocation" subsection under the DELIVERY project chip, with the same `team-search-*`, `project-type-btn`, `selected-team-chip` and `group-projects-subsection` classes. Lift the existing Product/Tech chip-column JSX (356-391) into one local render function that both projects and Allocation call, so the markup is not duplicated. The props come from `workConfigurationFormProps.js` (`allocationTypesDraft`, `addAllocationType`, `removeAllocationType`, search state) and patch `allocationTypes` through the existing `patch(id, …)`. Rename the label at line 229. The mockup (`assets/mockups/quarterly-work-structure-fields.jsx`) and its spec are a frozen design asset and stay as they are.
3. Verify: `npm run build && npx playwright test tests/ui/work_structure_settings.spec.js tests/ui/work_structure_one_lane.spec.js --browser=chromium`, plus a before/after screenshot of the DELIVERY Scope tab.

Status: done in 12f4b606; divergences: the Allocation search is disabled with a helper line until the Allocation field is mapped; Enter does not add a value (Escape closes the list); the Product/Tech chip columns carry `data-allocation-type` and the search block `data-allocation-types` (attributes only, no class). `tests/test_epm_settings_source_guards.js` lists the new optional props.

## Track B — Sprint scoping and suffix labels

### Task B1: Inherited-Board detection

1. Failing test first, in `tests/test_work_structure_catalogs.py`. With a DELIVERY stored `boardId: ''` and a Legacy Board → `board_inherited=True` with `source_mode=='board'`. With DELIVERY's own Board → `False`. Legacy → `False`.
2. Implement: add `board_inherited: bool = False` to `EffectiveCatalogConfig` (`workspace_catalog_config.py:16`). Set it in `resolve_catalog_sources` (459-472) by comparing `stored_bundle(snapshot.payload)` entries with the effective ones. Do not touch `work_structure.py`, which belongs to Track A.
3. Verify: `.venv/bin/python -m unittest tests.test_work_structure_catalogs`.

Status: done in 08d6f4c7; divergences: the observed (scan) supplement of an inherited source also carries `board_inherited=True`; the test is in `ObservedOnBoardConfigurationTests`.

### Task B2: Own-source Sprint ids

1. Failing tests first, in `ObservedOnBoardConfigurationTests`:
   - The inherited Board holds `2027Q1` (id 101) and the DELIVERY scan holds `2027Q1` (id 202). The catalog lists 202 only, `admit_sprint_source(…, 101)` → `sprint_catalog_mismatch`, and `…202` is admitted.
   - A Board-only name is **absent** for DELIVERY (Q1).
   - A pending scan → `refreshing`, and a failed scan → `failed`. Neither falls back to Board rows.
   - An own Board keeps every existing assertion (lines 523-593), and Legacy never scans.
2. Implement. In `_configuration_source_result` (`settings_routes.py:883-951`) and `admit_sprint_source` (`work_structure_routes.py:265-287`), when `config.board_inherited` is set, skip the Board snapshot and use the observed source's rows and envelope, keeping `sourceMode` and `identity` as today. Update the comments that state "Board row wins" so they name the own-Board case.
3. Verify: `.venv/bin/python -m unittest tests.test_work_structure_catalogs tests.test_work_structure_sprint_values`.

Status: done in dc3c1b5c; divergences: Sprint completion polling (`_configuration_completion_response`) also reads the scan for an inherited Board, since the envelope's `refreshAttemptId` is the scan's; `_configuration_cache_envelope` gained `identity_of` so the scan envelope answers with the configuration's `identity`/`rowIdentity`/`sourceMode`/`boardId`; an inherited-Board DELIVERY without a scan source (no projects or Sprint field) is `setup_required` instead of `ready`. Also rewritten on purpose (not in the list above): `SourceCatalogTests.test_board_and_issue_sources_merge_in_range_with_original_ids` (DELIVERY inherits, so its 2027Q1 is the retained scanned id 201, not Board 102) and `test_blank_source_is_setup_required_and_does_not_lock_the_other_era` (DELIVERY now `setup_required`, Legacy still answers).

### Task B3: Suffix rows

1. Failing tests first:
   - `tests/test_work_structure_sprint_values.py`: Legacy and DELIVERY both observe `2027Q1` → two rows `{value:'2027Q1', label:'2027Q1 - legacy', configurationIds:['legacy']}` and `{… 'delivery'}`, each with its own `sprintIds`.
   - A name seen by one configuration → one row with `label == value`.
   - For an inherited Board, DELIVERY contributes only scan rows (A7).
   - Rows sort by value descending, then Legacy first.
   - A header merged-catalog test (C3): rows from both configurations never repeat a `name`.
   - JS unit test for `sprintValueOptions`: option `id` is unique (`value` plus configuration), `name` shows the label, and selecting either row patches the bare `value`. `typedSprintOption`'s duplicate check compares `value`.
   - Grep guard: `rg -n " - (legacy|delivery)" backend jira_server.py` hits only the label builder.
2. Implement. `collect_sprint_values` keys rows by name, and when a name has more than one configuration it emits one row per configuration with `label`. The suffix comes from the configuration **id** (`legacy` or `delivery`), lowercase as specified, not the editable display name. `sprintValueOptions` and `SprintRanges` (`WorkConfigurationsEditor.jsx:96-108`) set `id` to the unique key and `onSelect` to `option.value`.
3. Verify: `.venv/bin/python -m unittest tests.test_work_structure_sprint_values` and `npm run build && node --test tests/test_work_structure_settings.js`. Then `npx playwright test tests/ui/work_structure_settings.spec.js --browser=chromium` with a screenshot of the Scope picker showing both rows.

Status: done in 9d706d65; divergences: every row carries `label` (equal to `value` unless shared); the option `id` is the label, which is `value` plus the configuration id when shared; `collect_sprint_values` also reports an inherited-Board source without a scan as `setup_required` (`test_setup_required_and_pending_sources_are_reported_not_errors` rewritten); the C3 uniqueness pin and the grep guard (only the label builder in `work_structure_routes.py` matches) were checked in the test and by hand; screenshot `tmp/screenshots/scope-picker-suffix.png` (synthetic data, not committed).

## Track C — integration, docs and gates (after A and B)

1. Re-run `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`. Re-sync only the touched registered files' `lineCeiling`, aggregates and `sourceDigest` in `scripts/extraction_lint/owner_budgets.json` (root AGENTS.md section 11). `jira_server.py` is 7515 lines against a ceiling of 8210 (`tests/test_codebase_structure_budgets.py:17`).
2. Analytics impact: **no new event.** The Allocation mapping is admin configuration saved through the existing Project config Save. The options read is a Settings metadata read, like `/api/work-structure/sprint-values`, which emits no `api_result`. The Product/Tech facet and split bar reuse the existing Legacy controls and their existing events. Add an allowlist row with this reason to `docs/README_ANALYTICS.md` (line 33 rule).
3. Docs:
   - In the DONE plan, add a current-accuracy note that D-D, D-E and D-C are superseded by this plan, editing nothing else.
   - SUPPORT design 153-155: Allocation is now the DELIVERY Product/Tech source.
   - `docs/TODO.md:76`: remove the resolved items.
   - `docs/ontology.md:69`: name the consumer (`allocation_classification.py`, stamp `projectClassification`) and date only that section's `Verified on`.
   - `docs/design-system.md` row 22: name the Allocation picker as a reuse of the project picker. No new kind.
4. Full gates (root AGENTS.md section 10): `npm ci` (fresh worktree), `npm run build`, `python3 -m unittest discover -s tests`, `npm run test:frontend:unit`, `npx playwright test tests/ui --browser=chromium --workers=4`. Read every summary line.

Status (steps 1-3): done. Step 1: `owner_budgets.json` raises only the dashboard ceiling (exact, 7503), `JiraFieldSettings.jsx` (958 lines, ceiling 1060) and `WorkConfigurationsEditor.jsx` (381 lines, ceiling 420); it records the twelve Allocation picker props on `JiraFieldSettings` (`propCount`/`propCeiling` 170, `expandedInputNames` +14) and drops the removed `workModel` input of `useEngCapacity`. `useEngCapacity.js` (452), `workConfigurationFormProps.js` (288) and `workConfigurationModel.js` (502) were already within their ceilings. No `sourceDigest` is re-stamped: both reviewed interfaces were already stale on the merge base (`a4466e5e`), so re-stamping would claim a review of drift this plan did not make. The extraction lint is red on the merge base and on this head with the same 70 enforced problems and 107 ESLint warnings (ratchet 106); this plan adds none. `tests.test_codebase_structure_budgets` and `tests/test_dashboard_regrowth_guard.js` pass. Step 2: allowlist row added to the No-Event Allowlist in `docs/README_ANALYTICS.md`. Step 3: the DONE plan's current-accuracy note, SUPPORT design (Allocation paragraph), `docs/TODO.md` (the undecided D-D/D-E/D-C item removed), `docs/ontology.md` (Quarterly project configurations: DELIVERY Product/Tech, inherited-Board Sprint rows, Scope suffix labels, Allocation consumer; `Verified on` 2026-11-09) and the `docs/design-system.md` Settings mapping picker row (reuse, no new kind). Step 4 (head `8684da3e`, 2026-11-09): fresh `npm ci` and `npm run build` OK; `python -m unittest discover -s tests` Ran 3435, OK (61 skipped); `npm run test:frontend:unit` 3495 pass, 0 fail; `npx playwright test tests/ui --browser=chromium --workers=4` 2291 passed, 19 skipped, 2 failed: `planning_review_integration.spec.js:708` (the pre-existing failure recorded in the quarterly migration plan) and `work_structure_stats_epm.spec.js:216` (Lead Times load-more, new-model quarter), which passes when run alone (2 passed) and is treated as load flake. Headed Firefox/WebKit not run.

## Acceptance checklist

- [x] DELIVERY Catch Up, Planning, Board and Stats show Product and Tech from Allocation. Unmapped, blank and unavailable values count as Product, and Ad Hoc beats Tech.
- [x] DELIVERY still makes exactly one `project=all` lane request, and Legacy requests are byte-identical.
- [x] The Objective fallback costs at most `ceil(objectives/40)` extra batches, and none when every Initiative is set.
- [x] Settings shows `Allocation` and a Product/Tech value picker built only from existing classes. Save stores `allocationTypes`, a mapping change changes the configuration digest, and the Sprint catalogs keep their `source_digest`.
- [x] A stale bundle without `allocationTypes` cannot erase the stored mapping.
- [x] The option list works under user OAuth (createmeta, then autocomplete, then a typed value), with no admin scope.
- [x] A DELIVERY entry with an inherited Board never lists or admits a Legacy Board Sprint id, and an own Board keeps the Board-wins rule.
- [x] The Scope picker shows `2027Q1 - legacy` and `2027Q1 - delivery` as separate rows. Selecting either stores `2027Q1`, and no Sprint name, saved `sprintName` or share link carries a suffix.
- [ ] Every test in "rewritten on purpose" is updated deliberately, with no assertion deleted without a replacement.
- [ ] Budgets, analytics row, docs and full gates done (Track C), and screenshots of the Settings Scope tab and the DELIVERY split bar attached.

Checklist evidence (2026-11-09, Track C, at the Track C budgets commit): `.venv` Python `tests.test_work_structure tests.test_planning_work_profiles tests.test_work_structure_allocation_options tests.test_endpoint_policy_inventory tests.test_allocation_classification tests.test_eng_board_service tests.test_eng_board_stream tests.test_work_reader_routes tests.test_work_structure_stats tests.test_work_structure_catalogs tests.test_work_structure_sprint_values`: `Ran 322 tests`, `OK`. After `npm run build`, Node 20 `node --test` over `test_work_structure_classification`, `test_eng_board_filters`, `test_eng_board_card_model`, `test_eng_board_view_model`, `test_work_structure_settings`, `test_capacity_classification`, `test_planning_selection_stats`: 106 pass, 0 fail. Chromium `work_structure_settings`, `work_structure_one_lane`, `work_structure_scope_sprint_values`: 66 passed. The option-list item is proven against mocked Jira only (createmeta, autocomplete and typed-value cases); no live Jira check was run. The suffix item is proven for the Scope picker, the saved bare value and the backend grep guard; share links carry Sprint ids and were not changed. Unticked: the rewritten-tests item (recorded per task in the Status lines, not re-audited in Track C; the concurrent read-only review covers it) and the last item (budgets, analytics row and docs are done; the full gates are the lead's step 4; the Scope tab, Scope picker and split-bar screenshots exist only as uncommitted local captures with synthetic data).
