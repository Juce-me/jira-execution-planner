# Quarterly work configuration migration implementation plan

> **Status:** Proposed implementation; not executed. Revised 2026-10-30 on `docs/quarter-sprint-terminology` to follow the operator's Department-style configuration editor. The confirmed new-structure boundary is `2027Q1`.
> **For implementers:** Use `subagent-driven-development` or `executing-plans` task by task. Follow root and plan instructions over skill defaults. This plan alone authorizes no implementation, push, pull request, Jira migration or production mutation. The operator separately requested a local commit of the design and mockup.

**Goal:** Keep the current work structure through `2026Q4` and use the new single-project structure from `2027Q1`, selected by the quarter being viewed.

**Architecture:** Store two revisioned project configurations and select one with a shared backend resolver. Admin has upper tabs **Project config**, **Capacity**, **Priority weights**, **Access**, **Performance**. Only Project config contains the Department-style left configuration list and right selected editor, with its own nested **Scope**, **Source**, **Field mapping** tabs. One global footer Save covers dirty owners; capacity remains workspace-wide.

**Stack:** Existing Python 3.10+/Flask/SQLAlchemy/Alembic and React 19/esbuild with Node 20.x. No new dependency.

## Product contract

- One dashboard Sprint is one quarter (`YYYYQn`). Initial configurations are **Legacy**, through `2026Q4`, and **DELIVERY**, from `2027Q1`. Ends are inclusive; a blank start/end means open-ended. The agreed boundary stays `2027Q1`.
- Admin upper tabs are exactly **Project config**, **Capacity**, **Priority weights**, **Access**, **Performance**. Within **Project config**, the left list selects Legacy/DELIVERY and scopes the right Sprint range, projects, source Board, hierarchy and fields. Name editing stays in the selected left row. At the top of that right editor show the selected name/range, then its nested tabs **Scope**, **Source**, **Field mapping**. Scope contains the sprint range and project selection; Source contains the source Board/Sprint field; Field mapping contains the structure and mapped fields. The fixture demonstrates the two structures through the existing Issue type picker (Story / Legacy or Epic / new structure), with no separate Structure control; implementation binds the supported model and hierarchy roles to that choice. The nested navigation is inside the right editor, not the upper Admin row. Default to Legacy selected.
- **Capacity** is a separate workspace-level upper tab, like Priority weights/Access/Performance. These four upper tabs hide the left configuration list and the configuration header/nested navigation; returning to Project config restores its selection, nested tab and unsaved drafts. Capacity mapping/storage/routes/verification are unchanged and never belong to a Legacy/DELIVERY entry.
- Reuse the existing selected-chip/Change/search/remove behavior, registered form rows, Department sidebar/drawer pattern and footer Save/Cancel. Switching configuration or editor tab retains its local draft. Configuration selection is inspection, not a data migration or app-scope change.
- Save atomically persists the complete structural configuration bundle with one revision check. An incomplete mapping can be saved if its shape/ranges are valid. Save does not certify Jira access or completeness. Selecting an unusable quarter shows concise setup guidance; never silently fall back to Legacy.
- Optional **Test configuration** uses the existing connection-test interaction for the saved selected configuration and reports a simple read-only result. It neither saves nor starts another workflow. No separate Work structure tab, overview cards, profile bar, readiness lifecycle, scheduling action or additional Save button.
- Match the [revised Settings specimen](../../assets/mockups/quarterly-work-structure-settings.html). Source and Field mapping must render the existing `JiraFieldSettings` component directly, with a fixture/controller adapter only; do not recreate their markup, cards, search controls, preview or CSS. The mockup adapter is [quarterly-work-structure-fields.jsx](../../assets/mockups/quarterly-work-structure-fields.jsx), built by [build_work_structure_mockup.cjs](../../scripts/build_work_structure_mockup.cjs) into ignored `tmp/` output. Earlier A/B/C specimens and captures are rejected concepts, not implementation targets.
- Preserve existing configuration ownership: workspace Admin planning inputs, collaborative Department groups, private group preferences and private EPM/Home configuration remain separate. No Jira/Home mutation or OAuth migration is added.
- Earlier quarters remain live Jira reads interpreted by Legacy configuration. This cannot recreate issue types, estimates, parents or project values changed in Jira; there is no as-of snapshot guarantee and no automatic issue conversion.

## Sources, current seams and unresolved field meanings

Source: [RnD work structure for 2027+](https://criteo.atlassian.net/wiki/spaces/~i.moldovan/pages/5492835223/RnD+work+structure+for+2027), version 41 dated 2026-10-29. The new quarterly unit is **Epic / team KR**, under Initiative / deliverable and Objective / project; Strategy / program is optional. Daily Stories can live in team projects and are optional operational children, not required quarterly rows.

| Area | Current implementation to verify again at execution |
| --- | --- |
| Storage/ownership | `backend/config/shared_config.py`, `backend/services/workspace_dashboard_config.py`, `backend/config/db_repository.py`, `json_repository.py`, `import_config.py`, `backend/config_store.py`; [ownership contract](../../backend/security/CONFIGURATION_OWNERSHIP.md). Today these resolve one current Admin payload without a quarter selector. |
| Catalogs/bootstrap | `backend/services/workspace_catalog_config.py`, `workspace_catalog_cache.py`, `catalog_refresh_runtime.py`, `catalog_app_adapter.py`, `sprints.py`, `sprint_teams.py`; `backend/routes/settings_routes.py`; `frontend/src/api/configApi.js`, `jiraCatalogApi.js`, `frontend/src/settings/useTeamCatalogLifecycle.js`, `frontend/src/dashboard.jsx`. Sprint identity includes Board; Team membership includes effective-scope digest. |
| Settings layout/save | `frontend/src/settings/AdminSettingsTabs.jsx`, `AdminSettingsContainer.jsx`, `JiraFieldSettings.jsx`, `DepartmentsSettingsTab.jsx`, `TeamGroupsSettings.jsx`, `useJiraProjectSettings.js`, `useCapacityMappingSettings.js`, `useSharedConfigSave.js`, `workspaceConfigConflict.js`. Reuse the Department pattern without copying its group ownership. |
| Hierarchy/Board | `jira_server.py::fetch_tasks` and field/project getters; `backend/routes/eng_routes.py`, `eng_board_routes.py`; `backend/services/eng_board.py`; `frontend/src/eng/engWorkHierarchy.js`, `useEngWorkHierarchy.js`, `engTaskUtils.js`, `useEngSprintData.js`, `useEngScope.js`, Board model/card/panel files. |
| Classification | `backend/services/eng_board.py::normalize_projects` rejects `unclassified`; `frontend/src/capacityClassification.mjs`, `frontend/src/eng/planningCapacityUtils.js`, `planningSelectionStats.js` default unknown values to Product. These require explicit new-model handling. |
| Stored user work | `backend/services/sprint_review.py`, `backend/db/models.py`, `backend/scenario_drafts.py`, corresponding review/Scenario routes and hooks. Review native cell kinds are `epic`/`story`; current view inheritance uses numeric Sprint-id order. |
| Statistics/EPM/export | `backend/routes/stats_routes.py`, `export_routes.py`, their `jira_server.py` functions; `frontend/src/stats/useStatsData.js`, `frontend/src/cohort/cohortUtils.js`, `frontend/src/jiraExportUtils.mjs`, `frontend/src/shareView/`; `backend/epm/rollup.py`, `issues.py`, `payload.py`, `backend/routes/epm_routes.py`, `frontend/src/epm/`. |

Consult the relevant [ontology](../ontology.md) sections and postmortems [catalog completeness](../postmortem/MRT030-sprint-catalog-page-limit.md), [review layouts](../postmortem/MRT033-review-columns-hidden-after-migration.md), [startup fan-out](../postmortem/MRT010-startup-api-load-fanout-and-overscoped-payloads.md) and [sticky tiers](../postmortem/MRT009-sticky-layering-regressions.md).

Resolve these semantics before enabling their dependent new-model features; ordinary configuration save and independent development do not wait for live Jira setup:

- **Work Area:** recommend a genuine single-select Jira field or an explicitly approved exact existing-field mapping for Project / Continuous Improvement / Interrupt / Org Invest. Do not infer it from Components or Allocation Category. An unconfigured field is visible as missing; Work Area filtering/reporting stays unavailable.
- **Project Track/owners:** recommend track on the KR itself, Assignee as KR dev owner and an independently mapped Delivery owner at the agreed roles. Confirm actual contexts/editability. Unconfirmed editors stay disabled; never derive the KR track from children.
- **Product/Tech:** recommend a unified new-model view with `unclassified` project type until a real classification is agreed. Keep Legacy split unchanged; do not derive a split from issue type or allocation.
- **Effort/dependencies:** confirm quarterly estimates, remaining/completed effort, capacity units and dependency meanings on actual KRs. Do not add KR effort to operational Story effort or parent/child work logs twice.

[GATE-05](GATE-05-home-write-capability.md) remains write-only, blocked and next due 2026-11-02 Europe/Berlin. No new approved target/PASS evidence was supplied, so the unchanged gate remains untouched inside its review window. Existing [Home public-read design](SUPPORT-home-oauth-public-read-design.md) and [setup evidence](../SUPPORT-atlassian-oauth-setup.md) continue to govern Home; this plan changes no Home auth route or query capability.

## Configuration and resolution contract

Add workspace Admin section `workConfigurations` in `workspace_dashboard_configs`. Each entry contains only its Project config editor (range/scope/source/roles/fields); workspace `capacity` remains a separate existing section; `revision` values are server-produced. The example is synthetic and intentionally has incomplete DELIVERY mappings that can be saved:

```json
{
  "schemaVersion": 1,
  "configs": [
    {
      "id": "legacy", "name": "Legacy", "revision": 1,
      "fromQuarter": null, "throughQuarter": "2026Q4", "model": "legacy",
      "scope": {"projects": [{"key": "OLDPLAN", "type": "product"}], "boardId": "7001", "baseJql": "project = OLDPLAN"},
      "roles": {"projectTypeIds": [], "deliverableTypeIds": ["19001"], "commitmentTypeIds": ["19002"], "programTypeIds": []},
      "legacyIssueTypeNames": ["Story"],
      "fields": {"quarter": {"fieldId": "customfield_19901", "fieldName": "Sprint"}, "estimate": {"fieldId": "customfield_19902", "fieldName": "Story Points"}, "team": {"fieldId": "customfield_19903", "fieldName": "Team"}, "parentName": {"fieldId": "", "fieldName": ""}, "projectTrack": {"fieldId": "", "fieldName": ""}, "deliveryOwner": {"fieldId": "", "fieldName": ""}},
      "allocation": {"source": "components", "fieldId": "", "inheritance": []},
      "workArea": {"source": "legacy"}, "projectTrackOwnerRole": "deliverable"
    },
    {
      "id": "delivery", "name": "DELIVERY", "revision": 1,
      "fromQuarter": "2027Q1", "throughQuarter": null, "model": "rnd_2027",
      "scope": {"projects": [{"key": "PLAN", "type": "unclassified"}], "boardId": "", "baseJql": "project = PLAN"},
      "roles": {"projectTypeIds": [], "deliverableTypeIds": [], "commitmentTypeIds": [], "programTypeIds": []},
      "fields": {"quarter": {"fieldId": "", "fieldName": ""}, "estimate": {"fieldId": "", "fieldName": ""}, "team": {"fieldId": "", "fieldName": ""}, "parentName": {"fieldId": "", "fieldName": ""}, "projectTrack": {"fieldId": "", "fieldName": ""}, "deliveryOwner": {"fieldId": "", "fieldName": ""}},
      "allocation": {"source": "field", "fieldId": "", "inheritance": ["commitment", "deliverable", "project"]},
      "workArea": {"source": "unconfigured"}, "projectTrackOwnerRole": "unconfirmed"
    }
  ]
}
```

Validate unique immutable opaque ids, supported model enum `legacy|rnd_2027`, nonempty display names, quarter syntax/order, nonoverlapping inclusive ranges and complete coverage with the agreed Q4/Q1 boundary. For this bounded migration require the two initial entries; no add/delete/arbitrary new-model designer. The id is not the model: a deliberate structure-model correction uses the same editor and normal revision-guarded Save. Do not freeze the model or introduce a correction wizard. Show concise in-form guidance that changes affect live views throughout the selected range. Empty mapping values are allowed; malformed IDs, duplicate role IDs, unknown keys and browser-supplied workspace/user/site/revision-verification authority are rejected. Limit bundle to 64 KiB, 20 Legacy projects, one DELIVERY planning project, five IDs per role and 32 KiB base JQL per entry. The existing global capacity project and optional external operational Stories are not additional planning projects. Reject `configs[].capacity`; the bundle must never copy, remove or overwrite workspace capacity.

Create `backend/services/work_structure.py` interfaces:

```python
normalize_work_configurations(payload: dict) -> dict
resolve_work_configuration(snapshot, *, quarter: str | None,
                           configuration_id: str | None = None) -> WorkConfigurationContext
project_legacy_admin_settings(context: WorkConfigurationContext) -> dict
```

`WorkConfigurationContext` is immutable: configuration id/revision/model, viewed quarter, workspace config revision, normalized digest, scope/roles/fields/allocation/work-area. A quarter matches exactly one saved inclusive range. With a quarter, reject a conflicting explicit configuration id; without a quarter, require an authorized saved selector from the current view. Missing required source, quarter/Team/estimate mapping or required new role ids produces `409 configuration_incomplete` with safe field paths, never another configuration. Optional program/parent-name/owner/track fields and unconfirmed Work Area do not block unrelated KR reads; show missing values or disable only their dependent editor/report. Test both an unusable required mapping and usable configuration with optional blanks. Capture this context and existing auth once per request and pass both explicitly to workers.

```python
def matches_quarter(config, quarter):
    return ((config["fromQuarter"] is None or config["fromQuarter"] <= quarter)
            and (config["throughQuarter"] is None or quarter <= config["throughQuarter"]))
```

Data responses carry `configuration={id,revision,model,quarter,configRevision,digest}`. Cache/stream/request identities include this stamp in addition to workspace/user/access/token partition. Range requests resolve each quarter separately. All work/Component/backlog inherit the configuration of the accepted dashboard quarter; show its name in the existing scope readout and use the existing selector to inspect another era. No calendar activation, mixed-hierarchy Board or Board-local Sprint selector.

## Storage migration and concurrent saves

- Before first bundle Save, existing storage remains authoritative. Under the existing workspace advisory fence, capture current **effective** Legacy projects, Board, base JQL, issue-type names and field mappings server-side. Preserve the separate global capacity section and verification metadata exactly. Build the migration baseline from that snapshot, not from omitted/browser-invented historical data; then apply explicitly edited validated Legacy fields from the normal revision-checked editor in the same transaction. First Save must not silently discard a deliberate Legacy edit or require a second Save. Initialize ranges/models as shown; keep the saved opaque ids stable. Later model or mapping corrections use ordinary Save with the same in-form historical-impact warning. Preserve unrelated Admin keys, groups, private preferences/EPM and catalogs.
- In that same transaction replace duplicated structural top-level keys (`projects`, `board`, field sections, `issueTypes`) with the canonical bundle. Capacity and priority weights remain workspace-wide; do not move/remove their keys or change their owning endpoints. Existing getters delegate through a captured configuration into their old shapes. Preserve exact Legacy issue-type-name semantics when ids are not yet discoverable; new role ids must be validated before runtime use.
- After promotion, structural section GET routes accept `configurationId`; a missing selector returns `409 configuration_required` rather than guessing. Global capacity GET/POST routes still require no configuration selector. Old structural POST setters return `409 configuration_bundle_required`; update every current UI/import/startup/repository caller together. Unpromoted legacy behavior remains. Never accept a partial structural writer that can split projects from mappings.
- Saving edited entries increments changed entry revisions and `configRevision` once. It does not change Jira, certify metadata, create another lifecycle or claim historical immutability. Disclose once beside Save that edits affect live views for the selected range. Range overlap/gap/boundary errors retain the draft; ordinary mapping corrections use the same Save/conflict handling.
- Keep `backend/services/shared_capacity_config.py`, the existing workspace capacity keys/verification columns and `/api/capacity/config` semantics unchanged. No per-configuration verification map, capacity proof transfer or new DB migration is required. A project-config-only save leaves global capacity values and proof untouched; the footer sends an independently dirty workspace capacity mapping through its existing endpoint and updates the shared revision between requests. If that later save fails, retain its draft and report only truly committed sections.
- DB compare/save uses the existing advisory fence. JSON mode uses per-path `threading.RLock` plus stable adjacent `fcntl.flock(LOCK_EX)` around read/revision-check/normalize/atomic-replace; all JSON structural writers/imports use it. Bound acquisition, release in `finally`, gitignore only its default generated lock filename and do not unlink/recreate the live lock. Test two-process as well as thread races. No DB-to-local fallback.
- Import/export retains Admin ownership. A legacy structural import after promotion becomes a selected-entry editor draft through explicit conversion, not an immediate overwrite or new owner. Startup never writes a bundle. No-request-context helpers receive captured configuration; only existing unconfigured startup paths explicitly use `source="jsonfile"`.
- A promoted bundle, including an incomplete one, is incompatible with older binaries because structural top-level keys were removed; the release rollback check must reject that binary downgrade. No Alembic downgrade is introduced for project configuration. A separately authorized verified restoration transaction would be required to run an older schema/binary; it is outside this plan. Forward rollback preserves stored bundle/review/draft records and fails closed on unsupported new-model views.

## Route and browser behavior

Register the bundle route in `backend/app.py` and `backend/security/policy.py`; use existing `apiFetch`. DB/OAuth identity comes only from current `RequestAuthContext`. Preserve local JSON/basic configuration mode without expanding production Basic support or claiming DB-only review capabilities.

| Route | Request and success | Required errors/checks |
| --- | --- | --- |
| `GET /api/work-structure/config` | Authenticated read; `{workConfigurations,configRevision,userCanEditSettings}`. No Jira validation or config write. | Existing `401` recovery, `503 config_storage_unavailable`; no payload workspace/site selector. |
| `POST /api/work-structure/config` | `shared_admin_write`; `{baseRevision,workConfigurations}`. Atomic `{workConfigurations,configRevision,changedConfigurationIds}`; no action/status/readiness fields. | `400 invalid_work_configurations` + safe `fields`; `403 admin_required/csrf_required`; `409 workspace_config_conflict`; `503` storage/lock. |
| `GET /api/test?configurationId=delivery&configRevision=19` | Extend existing authenticated read for saved configuration only. `{status:"success"|"error",configurationId,configRevision,message,checks:[{field,result:"pass"|"fail"|"unknown"}]}`; bounded read-only metadata/access test, no configuration or Jira mutation. Existing no-selector connection test remains unchanged. | `409` stale/unknown configuration; unavailable/missing metadata yields simple error/unknown, not false success. Sanitize this branch's messages; no raw provider bodies/identity. |
| `GET /api/config` | Existing bootstrap plus compact configuration names/ranges/models/revisions. Keep one early request; no new per-configuration startup test. | Existing timeout/auth/storage and edit-grant behavior. |
| Existing data/structural-section routes | Keep methods/rights/response contracts with additive configuration stamp; server resolves Sprint id to quarter. Structural projections require selector after promotion; global capacity routes/payloads are unchanged. | `400 invalid_quarter/ambiguous_configuration_scope`, `409 configuration_incomplete/configuration_scope_changed/configuration_required`; existing incomplete responses retained. |

Conflict example: `{error:"workspace_config_conflict",section:"workConfigurations",currentRevision:20,current:{workConfigurations:<complete normalized bundle>,configRevision:20}}`. The angle-bracket description means return the full valid bundle, never a literal placeholder/empty list. Save does not accept workspace/user/site or configuration verification fields; section POST aliases cannot bypass bundle compare/save.

OAuth unsafe methods, including read-only POST APIs already in use, require `X-Requested-With: jira-execution-planner` and token-bound `X-CSRF-Token`. `403` means authenticated insufficient rights; every application `401` terminally locks the mounted app behind existing same-tab recovery, preserves drafts and never automatically replays a failed write.

| UI situation | Expected normal Settings behavior |
| --- | --- |
| Open/select | Upper Admin row: Project config / Capacity / Priority weights / Access / Performance. Project config alone shows the left Legacy/DELIVERY list and right selected editor; right nested row: Scope / Source / Field mapping. Inline name only at left; sprint-range controls live under right-hand Scope, and Structure under right-hand Field mapping. |
| Upper tab switch | Capacity/weights/access/performance hide the configuration list, selected-name/range header and nested tabs; each shows its existing workspace panel. Return to Project config retains left selection, nested tab and all drafts. |
| Dirty switch | Preserve both configurations' drafts and per-editor tab choice. No auto-save or destructive reset on left selection. |
| Save | One structural bundle call through existing footer plus other dirty editable owners through their existing endpoints. Dirty workspace capacity uses `/api/capacity/config` with the revision returned by the prior bundle save. Keep truthful partial-save reporting; independent ownership endpoints are not one DB transaction. |
| Test | Optional simple test of the saved selected configuration. If dirty, state that current edits must be saved first; incomplete values never block ordinary Save. |
| Stale save/reload | Retain local drafts in existing conflict surface; explicit Reload discards after current confirmation behavior. Clean state adopts server baseline; dirty state never silently overwrites. No new polling/SSE. |
| Scope/auth change | Retire old requests/menus; preserve appropriately stamped Planning/Scenario drafts through existing guards. A stale result cannot relabel old data or enable a write in another configuration; auth recovery stays global. |

## Hierarchy and calculation rules

Create `backend/services/planning_work.py::load_planning_work(context, *, auth_context, quarter, team_ids, purpose, transport) -> PlanningWorkSnapshot`. Two adapters implement it: Legacy preserves current Epic/Story behavior; RnD 2027 starts from quarterly team Epics, batches Initiative/Objective/optional Strategy context and exposes optional daily children separately. Snapshot keys are `configuration`, `deliverables`, `commitments`, `ancestors`, `operationalChildren`, `dependencies`, `completeness`; every issue keeps actual immutable id/current key/type/role/source project. Never relabel an Epic as a Story to reuse JSON/UI.

- Query KRs by mapped quarter + one Team + actual type. Do not require quarter/Team on Initiative or Objective. Missing/unreadable optional parents do not drop readable KRs. Daily Stories are not mandatory for KR visibility, estimates, readiness or selected-quarter EPM rollup.
- Allocation resolves nearest explicit KR -> Initiative -> Objective. Readable blank may continue; inaccessible intermediate parent is an unknown possible override. Blank KR + unreadable Initiative + populated Objective yields unavailable, not a confirmed Objective category. Explicit KR value wins despite unreadable ancestors. Show provenance/missing/unavailable; never inherit from daily Stories.
- New-model readiness checks agreed KR fields; legacy Create Stories and child-unestimated prompts do not become KR health. Dependencies retain real issue identities. Missing/remaining effort is visible, never fabricated zero. Sum each KR's estimate once; do not add operational child points or duplicate parent/child work logs.
- Admit new `unclassified` through Board/backend/client classifiers. An unclassified new KR worth 8 points yields total 8, Product 0, Tech 0, unclassified 8 across selection/capacity/Board/export. Preserve Legacy fallback semantics; no hidden Product attribution to satisfy existing validators.
- Bound new enrichment: depth three above KR, batches <=100 ids, <=1,000 KRs, <=300 distinct ancestors and <=20 enhanced-search pages within a cooperative 15-second budget; respect stricter existing endpoint limits. Return explicit incomplete/too-large state instead of silent truncation.
- Enhanced issue search uses `nextPageToken`/`isLast`; project search uses `startAt`/`isLast`; Sprint discovery retains its validated Agile pagination and caps. Use one scoped fetch and client regrouping, not per-issue fan-out.

## Implementation tasks and allowed files

Write each task's failing behavioral tests first, run to establish failure, implement its contract, then run its focused gate. Existing files named below were traced during review; verify again before editing. No commit is implied by a task.

### Task 1: Bundle storage, resolver and compatibility

**Create:** `backend/services/work_structure.py`, `tests/test_work_structure.py`, `tests/test_work_structure_storage.py`. The bundle uses the existing JSON payload column; no DB migration is introduced.
**Modify:** `backend/config/shared_config.py`, `backend/services/workspace_dashboard_config.py`, `backend/config/db_repository.py`, `json_repository.py`, `import_config.py`, `backend/config_store.py`, `.gitignore` for generated lock, `jira_server.py` configuration wrappers.
**Interface:** produces `WorkConfigurationContext` and one bundle update under the current revision fence.

- [ ] Test Q4/Q1 range selection, inclusive ends/open bounds, overlap/gap/reversed/fixed-boundary rejection, incomplete mapping Save and unusable-quarter errors. Test server-only first Legacy capture, unrelated-owner preservation, correction revision and no write-on-read.
- [ ] Implement full source promotion/delegating getters/old writer rejection, both repositories and selected-entry import/export. Exercise two workspaces, thread/process stale-save races and rollback on failed normalization/transaction.
- [ ] Test source promotion in SQLite/configured PostgreSQL and JSON storage without schema changes; global capacity keys and verification columns remain byte-for-byte unchanged. Test explicit rejection of nested `configs[].capacity` and binary rollback incompatibility guidance for a promoted bundle.
- [ ] Run `.venv/bin/python -m unittest tests.test_work_structure tests.test_work_structure_storage tests.test_workspace_dashboard_config_service tests.test_shared_capacity_config_db tests.test_config_jsonfile_fallback`.

### Task 2: Routes, existing test interaction and selected editor

**Create:** `backend/routes/work_structure_routes.py`, `frontend/src/settings/WorkConfigurationsEditor.jsx`, `frontend/src/settings/useWorkConfigurationSettings.js`, `tests/test_work_structure_routes.py`, `tests/test_work_structure_settings.js`, `tests/ui/work_structure_settings.spec.js`.
**Modify:** `backend/app.py`, `backend/security/policy.py`, `backend/routes/settings_routes.py`, `diagnostic_routes.py`, `jira_server.py::test_connection`; `frontend/src/settings/AdminSettingsContainer.jsx`, `AdminSettingsTabs.jsx`, `JiraFieldSettings.jsx`, `useJiraProjectSettings.js`, `useSharedConfigSave.js`, `workspaceConfigConflict.js`, `frontend/src/api/configApi.js`, `frontend/src/dashboard.jsx` composition, `docs/design-system.md` registry.
**Interface:** consumes Task 1; produces route matrix and Department-style selected configuration editor.

- [ ] Implement route tests for explicit edit grant, non-admin 403, missing/wrong CSRF/requested-with, two-workspace isolation, rejected identity fields, stale revisions, incomplete successful Save and config-storage failure. Test selected `/api/test` metadata failure/unknown/empty results without mutation or false success; no new server lifecycle.
- [ ] Replace sequential structural setters with one footer bundle call. Keep dirty workspace capacity, priority weights, groups/preferences/EPM at owning endpoints. Chain shared revisions through the existing capacity save; preserve its payload and verification logic. Guard only old structural POSTs: `/api/projects/selected`, `/api/board-config`, each field `/config` and `/api/issue-types/config`; direct imports/repository calls cannot bypass it.
- [ ] Reuse `.group-modal-body`, `.group-pane-left`, `.group-list-item`, `.group-pane-right`, the mobile Configurations drawer only inside upper Project config, with nested Scope/Source/Field mapping inside the right pane; upper Capacity/weights/access/performance keep existing global panels and hide all configuration chrome. No new control grammar. Browser tests: selected Legacy/DELIVERY scope, inline left name, Sprint-range Change under right Scope and Structure Change under right Field mapping, model correction via normal Save, both drafts surviving list/tab switches, one footer Save, dirty bundle plus global-capacity revision chaining/partial failure, configuration state preserved across upper tabs, incomplete Save, conflict retaining draft, read-only user, global 401 and simple saved-config test.
- [ ] Capture settled desktop/mobile screenshots matching the revised specimen; normal-click menu layering, text/control/footer geometry and clipping assertions. Keep existing sticky tiers.
- [ ] Run `.venv/bin/python -m unittest tests.test_work_structure_routes tests.test_endpoint_policy_inventory tests.test_shared_admin_config_recovery`; `npm run build`; `node --test tests/test_work_structure_settings.js tests/test_use_shared_config_save.js tests/test_config_api.js`; `npx playwright test tests/ui/work_structure_settings.spec.js --browser=chromium --workers=1`.

### Task 3: Catalogs, bootstrap and request authority

**Create:** `tests/test_work_structure_catalogs.py`, `frontend/src/workStructure/configurationContext.js`, `tests/test_configuration_context.js`.
**Modify:** `backend/services/workspace_catalog_config.py`, `workspace_catalog_cache.py`, `catalog_refresh_runtime.py`, `catalog_app_adapter.py`, `sprints.py`, `sprint_teams.py`, `backend/routes/settings_routes.py`, `eng_routes.py`; `frontend/src/api/jiraCatalogApi.js`, `configApi.js`, `frontend/src/settings/useTeamCatalogLifecycle.js`, `frontend/src/eng/engSprintSelectorState.js`, `frontend/src/dashboard.jsx` composition.
**Interface:** validated quarter -> configuration/actual Board/Sprint identity and browser generation.

- [ ] Retain both source Board catalogs; same-named quarter rows across Boards keep physical identities. Preserve Legacy `deduplicate_sprints_by_name` Board-membership/state/stable-tie behavior and existing `tests/test_sprint_service.py` cases; never deduplicate across configurations. Validate the new source without newly breaking readable Legacy duplicates.
- [ ] Build quarter choices from matching configuration ranges; scope Team digest to configuration. Refresh/publish recaptures the same config/auth fence; complete empty lists remain authoritative and failures never publish partial data. A new-source error must preserve valid older choices.
- [ ] Keep one early config + group bootstrap and no test-per-config startup fan-out. Retire stale completion work on quarter/config/auth change; test reversed numeric Sprint ids and delayed responses after selection switch.
- [ ] Run `.venv/bin/python -m unittest tests.test_work_structure_catalogs tests.test_workspace_catalog_config tests.test_sprint_service tests.test_sprint_team_service`; `node --test tests/test_configuration_context.js tests/test_early_bootstrap.js tests/test_eng_sprint_selector_state.js` after build when bundle-reading tests require it.

### Task 4: Hierarchy adapters and all ENG consumers

**Create:** `backend/services/planning_work.py`, `tests/test_planning_work_profiles.py`, `tests/fixtures/work_structure_reference.py`, `tests/test_work_structure_consumer_inventory.py`.
**Modify:** `jira_server.py` task/enrichment/cache helpers, `backend/routes/eng_routes.py`, `eng_board_routes.py`, `backend/services/eng_board.py`, `story_readiness.py`, `alert_epics.py`, `group_config.py`; `frontend/src/eng/engWorkHierarchy.js`, `useEngWorkHierarchy.js`, `engTaskUtils.js`, `useEngSprintData.js`, `useEngScope.js`, `EngView.jsx`, `EpicBlock.jsx`, Board model/card/panel files, `frontend/src/capacityClassification.mjs`, `frontend/src/eng/planningCapacityUtils.js`, `planningSelectionStats.js`, shared issue rendering only where actual role data is consumed.
**Interface:** produces `PlanningWorkSnapshot`; Legacy and RnD adapters consume captured Task 3 context.

- [ ] Test Legacy Epic/Story and new quarterly Epic with optional external daily Story, absent Objective, inaccessible Initiative, exact allocation-override cases and no double-counted estimate. A KR without Stories remains valid/plannable and produces no legacy Create Stories alert.
- [ ] Migrate Catch Up, Planning List/Table, all Board scopes/streams, backlog, per-row refresh, dependencies/lookup, missing info, excluded/Ad Hoc planning issue sets, alerts, Jira links and export to captured project context. Read capacities independently through the unchanged workspace capacity mapping. Keep source guards against global getters/hard-coded Story planning units; include real OAuth-wrapper worker tests with no Flask request context.
- [ ] Pin `eng_board.py::normalize_projects`, `capacityClassification.mjs`, `planningCapacityUtils.js`, `planningSelectionStats.js` so an 8-point new unified KR yields exactly 8 total and zero Product/Tech. Keep legacy calculations intact; optional operations are labeled separately.
- [ ] Run `.venv/bin/python -m unittest tests.test_planning_work_profiles tests.test_work_structure_consumer_inventory tests.test_story_readiness`; `node --test tests/test_eng_work_hierarchy.js tests/test_eng_task_utils.js tests/test_planning_selection_stats.js tests/test_planning_capacity_utils.js`.

### Task 5: Writes, reviews, Scenario, sharing and export

**Create:** `tests/test_work_structure_write_guards.py`, `tests/test_work_structure_reviews.py`, `tests/test_work_structure_scenario.py`, `tests/ui/work_structure_transition.spec.js`.
**Modify:** `backend/routes/eng_routes.py`, `backend/services/jira_issue_field_edits.py`, existing status/priority/track services reached from those routes, `backend/services/sprint_review.py`, `backend/routes/sprint_review_routes.py`, `backend/scenario_drafts.py`, `backend/routes/scenario_draft_routes.py`, `scenario_routes.py`, `export_routes.py`; inline-edit/review/Scenario hooks, `frontend/src/eng/planningReviewTableModel.js`, `frontend/src/api/sprintReviewApi.js`, `scenarioApi.js`, `frontend/src/shareView/codec.js`, `resolver.js`, `viewDefaults.js`, `frontend/src/jiraExportUtils.mjs`.
**Interface:** all writes/source snapshots carry the effective configuration stamp; actual issue identity remains authoritative.

- [ ] Compare stamp + current mapping + own-issue/editmeta/authorization before every existing project issue field/status/priority/track write. Global capacity writes retain their current workspace config/mapping revision, own-issue and authorization checks without a project configuration selector. Register adapted write call-site pins first. A correction or scope switch rejects stale writes before Jira mutation; parent fields never write through a child.
- [ ] Preserve review immutable ids, native Epic/Story kinds and group-wide values. New KRs use actual `epic` cells; no Story-to-KR copy or Initiative-as-Epic trick. Table shows KRs with read-only parent context; new-quarter layout starts safe unless user explicitly adopts a compatible layout. Keep legacy numeric inheritance within Legacy; new-model inheritance uses validated quarter order without crossing configurations. Resolve prior compatible views through validated quarter-to-Sprint catalog identities using the existing view tables; preserve cell uniqueness and introduce no new DB migration for configuration or capacity.
- [ ] Stamp Scenario sources/versions with configuration id/revision/model/quarter/digest. Unstamped existing drafts read as Legacy without write-on-read; next save records it. Reload/rollback never reinterpret by current selection; mismatch preserves overrides and uses existing explicit reload/rebase recovery. Enable no new publish/writeback path.
- [ ] Share links derive configuration from quarter; optional fixed configuration enum handles quarterless links at existing `v=1`. Resolve against recipient access. Export the admitted loaded scope with real types, no hidden cross-config refetch. Test same issue id after type change, reversed Sprint ids, inaccessible draft ids and auth expiry.
- [ ] Run `.venv/bin/python -m unittest tests.test_work_structure_write_guards tests.test_work_structure_reviews tests.test_work_structure_scenario tests.test_sprint_review tests.test_scenario_draft_routes tests.test_scenario_draft_security_source_guards`; relevant review/Scenario/share-link JS suites; `npx playwright test tests/ui/work_structure_transition.spec.js --browser=chromium --workers=1`.

### Task 6: Statistics and EPM without changing private ownership

**Create:** `tests/test_work_structure_stats.py`, `tests/test_work_structure_epm.py`, `tests/ui/work_structure_stats_epm.spec.js`.
**Modify:** `backend/routes/stats_routes.py`, affected `jira_server.py` functions, `frontend/src/stats/useStatsData.js`, `statsUtils.js`, `StatsPanel.jsx`, `excludedCapacityStats.js`, `frontend/src/cohort/cohortUtils.js`; `backend/epm/rollup.py`, `issues.py`, `payload.py`, `backend/routes/epm_routes.py`, `frontend/src/api/epmApi.js`, `frontend/src/epm/EpmSettings.jsx`, `EpmSettingsTab.jsx`, `EpmRollupTree.jsx`, `EpmRollupPanel.jsx`, `EpmView.jsx`.
**Interface:** partitioned quarter calculations and effective hierarchy disclosure on existing EPM responses.

- [ ] Resolve each quarter before fetch; show the Q1 structure boundary. Separate incompatible Story/Epic counts, lead times and completion units; combine only tested equal-grain/unit metrics. New allocation uses inherited dedicated field, not Components; Product/Tech-only charts show unavailable guidance until agreed. Creation/closure cohorts cannot infer model from creation date; Last N stays within selected configuration.
- [ ] In Legacy use private `epm.issueTypes` exactly as today. For RnD 2027, workspace role IDs control Jira discovery/rollup; preserve non-default private legacy presets without write-on-read. Return `effectiveHierarchy={source:"workspace_configuration",model:"rnd_2027",roles:...}`. EPM Settings clearly shows workspace-controlled read-only roles for the new selected quarter and editable private presets for Legacy, never editable-looking ignored controls.
- [ ] Keep private Home goals/exact-label mappings/enablement/OAuth path. Quarter filters KRs, not ancestor discovery; daily Stories are optional and metadata-only Home cards retain existing CTA. Add configuration digest to existing private EPM/auth cache identity and carry both contexts to workers. No `backend/epm/home.py` credential/query/scope migration.
- [ ] Negative tests patch `backend.epm.home._home_basic_credentials`, `_read_metadata_credential`, `build_home_graphql_client`, `build_teamwork_graph_client`, `jira_server.oauth_session_data`, `save_oauth_session` to raise in DB/OAuth reads. Spy `backend.auth.jira_auth.build_jira_headers` for OAuth-only mode; forbid its Basic `base64.b64encode` branch. Assert zero Home mutations/Jira writes, two-user private preset preservation and two-workspace isolation.
- [ ] Run `.venv/bin/python -m unittest tests.test_work_structure_stats tests.test_work_structure_epm tests.test_oauth_stats_routes tests.test_epm_rollup_api tests.test_epm_config_api`; relevant Statistics/EPM JS suites; `npx playwright test tests/ui/work_structure_stats_epm.spec.js --browser=chromium --workers=1`.

### Task 7: Documentation, analytics and complete verification

**Create:** `tests/test_work_structure_analytics.js`, `docs/features/quarterly-work-structure.md`.
**Modify:** `frontend/src/analytics/events.js`, `dashboardAnalytics.js`, `docs/README_ANALYTICS.md`, `backend/security/CONFIGURATION_OWNERSHIP.md`, touched ontology sections, `docs/features/README.md`, `README.md`, `docs/plans/README.md`, design-system registry/pins and relevant extraction budgets/source digests. Update GA4 runbook only if transport/property mapping changes.

- [ ] Reuse `settings_action`: trigger `userevent`, event_type `event`, canonical event_name `settings_action`, feature_name `settings`, section `work_configurations`, workflow_action `save_result|test_result`, result `success|failure|conflict`, existing bucketed validation count only. List/tab/draft churn and derived configuration selection emit no new event. Existing quarter/filter events continue; collect no names/ids/quarters/JQL/digests/revisions. Test approved enum additions without new keys.
- [ ] Preserve two GTM triggers (`pageview`/`userevent`), `GA4_ENABLED`, logical page names and no consent UI; never add UA fields, `event_group`, `ga4_event_name`, presence dimensions or bulk custom definitions. No new GA4 mapping/runbook change is expected; document that rationale and add mapping tests if implementation changes it.
- [ ] Document ranges, live-history limits, incomplete Save/runtime setup guidance, source migration/rollback, unchanged workspace capacity ownership and EPM private precedence. Date touched ontology sections only; never edit its Coverage line. Keep contributor docs aligned and retain actual screenshots/test outcomes.
- [ ] Run acceptance below and record unresolved live checks honestly. Before publication follow root exact-head build/full tests and explicit approval; rename to `DONE-quarterly-work-structure-migration.md` only after implementation/required verification, updating status/outcome/index/links together. Planning/mockup completion alone does not justify that rename.

## Acceptance and evidence

| Must prove | Check |
| --- | --- |
| One selected editor | Exact upper Admin row Project config/Capacity/Priority weights/Access/Performance; only Project config has left list and right nested Scope/Source/Field mapping. Global panels hide configuration chrome; returning restores selection/drafts. One footer Save. |
| Temporal correctness | Q4 -> Q1 -> Q4 uses exact saved configuration; inclusive range validation; incomplete Q1 shows setup error, not Legacy; stale responses/writes cannot cross. |
| Migration/concurrency | Server captures Legacy; old writers/import/startup cannot split source; DB and two-process JSON stale saves reject; promoted binary downgrade is rejected until verified restoration; global capacity keys/proof/routes remain unchanged. |
| New quarterly meaning | KR without daily Stories visible; actual types; optional ancestors; unreadable override stays unavailable; each estimate counted once; zero accidental Product split. |
| User work/ownership | Existing review cells/layouts and stamped Scenario sources survive; private EPM presets preserved; shared groups unaffected; own-issue and workspace/auth checks hold. |
| Runtime/UI | Complete catalogs and retained Legacy dedup; scoped/bounded calls and measured startup count; simple saved-config test; settled screenshots and normal-click geometry/layer tests. |

Use pinned Node 20 and the configured Python environment. Build before tests reading `frontend/dist`; never hand-edit generated output. A new worktree needs its own installed frontend dependencies for reproducible build; do not install without authorization or inherit ancestor node_modules. UI fixtures may use `JEP_TEST_PYTHON` for the existing Python environment. Never use worktree port 5050 or stop another server.

```bash
npm run build
python3 -m unittest discover -s tests
npm run test:frontend:unit
npx playwright test tests/ui --browser=chromium --workers=4
python3 -m unittest tests.test_agents_md_learnings tests.test_codebase_structure_budgets
```

Also run configured PostgreSQL storage/concurrency tests, startup preflight, this checkout's verified `/api/test`, and headed Firefox/WebKit geometry guards when their controls are affected. No UI CI job is added. Independent development uses synthetic metadata; live acceptance later verifies real project/Board/type/field access, complete quarter catalogs, existing KRs or explicit empty-data evidence, agreed effort/field meanings, two users and supported SSO. No daily Story creation is required. Keep real issue data/credentials/local paths out of tracked artifacts.

The design/mockup deliverable is documented in [Quarterly project configurations design](SUPPORT-quarterly-project-configurations-design.md), including current screenshots, alternatives and the actual verification results. Build and serve it with `node scripts/build_work_structure_mockup.cjs --serve`, then open `http://localhost:5062/assets/mockups/quarterly-work-structure-settings.html`. Use `--port=5063` if the default port is occupied. Static controls use synthetic data only, load no analytics, save no app configuration and do not prove a live Jira test.

## Outcome

Design, implementation plan and component-based mockup prepared on `docs/quarter-sprint-terminology`. No application/database/Jira implementation has executed. All implementation tasks remain unchecked. The frontend build passed; focused mockup Chromium checks passed 5 tests, documentation/structure checks passed 21 tests, and the existing field-picker unit suite passed 19 tests. These validate the deliverable, not the application migration. Production UI/live Jira acceptance remains unexecuted.

## Current accuracy

Rewritten on 2026-10-30 for the operator's exact two-level Admin navigation, Department-style Project config editor and confirmed Q1 cutover. Capacity remains workspace-level. This version supersedes the earlier lifecycle/overview concepts. Current implementation paths were traced; exact live mappings, Work Area/track/effort decisions and new-model performance remain unverified. Recheck current symbols and Alembic head before execution; incomplete configuration remains an ordinary saved state with clear runtime setup guidance.
