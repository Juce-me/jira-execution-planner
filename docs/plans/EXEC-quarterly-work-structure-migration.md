# Quarterly project configurations implementation plan

> **Status:** Proposed implementation; not executed. Revised 2026-10-30 after the operator resolved six design questions. The initial ranges end Legacy at `2026Q4` and start DELIVERY at `2027Q1`; ranges remain editable.
> **For implementers:** Follow root, docs and plan instructions; execute task by task with the available execution skill. This document alone authorizes no production implementation, Jira migration, publication or history rewrite. The design/mockup commit request is separate.

**Goal:** Select the saved project configuration for the dashboard quarter and preserve existing behavior while moving new planning work up one Jira level.

**Architecture:** One revisioned workspace project-configuration bundle; one captured backend configuration context; two explicit adapters with editable Jira type mappings. Admin has upper tabs **Project config / Capacity / Priority weights / Access / Performance**. Only Project config contains the left configuration list and right **Scope / Source / Field mapping** nested tabs. Capacity stays global.

**Stack:** Existing Python 3.10+/Flask/SQLAlchemy/Alembic and React 19/esbuild, Node 20.x; no new dependency.

## Operator decisions and scope

| Existing Jira entity | New Jira entity | Behavior |
| --- | --- | --- |
| Story | Epic | Same planning calculations, actions and alerts applied one level higher |
| Epic | Initiative | Same parent grouping and sums of its planning children |
| Initiative | Objective | Same higher grouping/context |
| No required extra parent | Strategy, optional | Optional context; absence does not remove readable work |

- Use Jira entity names only in product controls: Story, Epic, Initiative, Objective, Strategy. Each hierarchy row selects **one** issue-type id using the existing chip/search picker pattern. Do not rename entities to invented planning vocabulary or expose a generic hierarchy designer.
- `model=legacy|rnd_2027` is an explicit stored adapter tag, initialized independently of editable type names/ids. Picking, clearing or renaming an issue type never switches the model, project classification or Scope layout. There is no separate model wizard or implicit literal `Epic` -> model conversion.
- Initial ranges are Legacy open-start through `2026Q4` and DELIVERY `2027Q1` through open-end, inclusive. Edit them normally; validate start <= end, adjacent complete coverage and no overlap/gap. Do not hard-code Q4/Q1 as the only valid values. An invalid edit can be corrected in place without discarding other drafts.
- Preserve **every calculation** and each surface's current status, selection, exclusion, Ad Hoc, Killed/Incomplete and capacity rules; shift their Jira inputs one level. Initiative Story Points displayed as a sum of its Epics follows the same surface rule that formerly summed Stories under Epic. Do not add a new effort field, formula or universal status filter.
- Existing alerts shift too: Department Team-label aliases match **Initiatives** in the new model and define expected Team **Epics** in the selected Sprint. No daily Story is required to satisfy planning or an alert. Legacy labels still match Epics and expect Stories.
- New planning uses one combined total and existing project type **`other`**. Keep Legacy Product/Tech behavior. Components or Labels could support a future split, but no classification rule is defined here; do not infer one from type, Allocation or unknown values.
- Add Project Track and Allocation field mappings using the existing field-picker pattern. Allocation is the new dedicated Jira field; there is no invented Legacy allocation feature or separate Work Area configuration. Preserve all existing calculation semantics.
- Scope is design/mockup and the implementation contract. Do not migrate Jira issues, create/reparent daily work, add Home writes/auth migration or claim historical snapshots.

## Settings behavior and ownership

[Feature design](SUPPORT-quarterly-project-configurations-design.md) and [mockup](../../assets/mockups/quarterly-work-structure-settings.html) describe the exact two-level layout. Legacy is initially selected; its name is editable only in the active left row. Scope has quarter ranges/projects; Source has the saved Board/Sprint field; Field mapping has the hierarchy rows and mapped fields. Extend `JiraFieldSettings.jsx` with the additional rows while retaining its existing components/classes/picker helpers; the earlier claim that the production component can remain unchanged is superseded.

Upper Capacity/weights/access/performance tabs hide configuration chrome; returning restores left selection, nested tab and independent drafts. Reuse the Department drawer on compact screens. Source/Mapping must not duplicate production form markup in the fixture. Controller changes emit patches only, so a field edit cannot overwrite a newer inline rename. Render project chips from stored project types; a mapping change cannot hide a stored project.

One global footer Save persists all dirty editable owners. Structural ranges/projects/source/type/field mappings save atomically as one bundle. Global Capacity and priority weights retain their existing endpoints/verification; chain returned workspace revisions and report partial success accurately. Failed sections remain dirty. Cancel follows the current dirty-discard confirmation. Test configuration is a simple optional read of the saved selected project configuration; never show a project-scoped test on global Capacity.

Incomplete mappings may be saved when shape/ranges are valid. Selecting an unusable quarter displays concise setup guidance, never Legacy/env fallback. Optional unavailable fields disable only dependent controls/reports. A concise in-form warning says corrections affect live reads for the selected range. Existing permission, stale-save/reload, global terminal `401` recovery and mounted-draft preservation remain; no lifecycle, arming, impact wizard or per-tab Save.

[Ownership](../../backend/security/CONFIGURATION_OWNERSHIP.md) remains workspace Admin project settings, unchanged workspace Capacity, collaborative Department groups and private group preferences/EPM. EPM Home scope/exact labels/private Legacy type presets never move into Admin. Earlier-quarter views interpret current Jira data; no configuration can reconstruct a moved/deleted/retyped issue as it existed historically.

## Schema and hierarchy metadata

Add Admin section `workConfigurations`. Its entries contain stable opaque id, editable name/range, explicit model, scope, hierarchy and fields. Illustrative saved data uses synthetic ids; blanks are intentionally saveable:

```json
{
  "schemaVersion": 1,
  "configs": [
    {
      "id": "legacy", "name": "Legacy", "revision": 1,
      "fromQuarter": null, "throughQuarter": "2026Q4", "model": "legacy",
      "scope": {"projects": [{"key": "OLDPLAN", "type": "product"}], "boardId": "7001", "baseJql": "project = OLDPLAN", "teamJqlTemplate": "", "statsBaseJql": "project = OLDPLAN", "statsOrderBy": ""},
      "hierarchy": {"planningIssueTypeId": "19001", "parentIssueTypeId": "19002", "ancestorIssueTypeId": "19003", "optionalAncestorIssueTypeId": null},
      "legacyIssueTypeNames": ["Story"],
      "fields": {"sprint": {"fieldId": "customfield_19901", "fieldName": "Sprint"}, "storyPoints": {"fieldId": "customfield_19902", "fieldName": "Story Points"}, "parentName": {"fieldId": "customfield_19903", "fieldName": "Epic Name"}, "team": {"fieldId": "customfield_19904", "fieldName": "Team"}, "projectTrack": {"fieldId": "customfield_19905", "fieldName": "Project Track"}, "deliveryOwner": {"fieldId": "", "fieldName": ""}, "allocation": {"fieldId": "", "fieldName": ""}}
    },
    {
      "id": "delivery", "name": "DELIVERY", "revision": 1,
      "fromQuarter": "2027Q1", "throughQuarter": null, "model": "rnd_2027",
      "scope": {"projects": [{"key": "PLAN", "type": "other"}], "boardId": "", "baseJql": "project = PLAN", "teamJqlTemplate": "", "statsBaseJql": "project = PLAN", "statsOrderBy": ""},
      "hierarchy": {"planningIssueTypeId": null, "parentIssueTypeId": null, "ancestorIssueTypeId": null, "optionalAncestorIssueTypeId": null},
      "fields": {"sprint": {"fieldId": "", "fieldName": ""}, "storyPoints": {"fieldId": "", "fieldName": ""}, "parentName": {"fieldId": "", "fieldName": ""}, "team": {"fieldId": "", "fieldName": ""}, "projectTrack": {"fieldId": "", "fieldName": ""}, "deliveryOwner": {"fieldId": "", "fieldName": ""}, "allocation": {"fieldId": "", "fieldName": ""}}
    }
  ]
}
```

IDs persist; names are display metadata, never behavior switches. Null means unconfigured/optional. Initial Legacy maps Story/Epic/Initiative/(none); initial new configuration maps Epic/Initiative/Objective/optional Strategy when metadata is available. Metadata absence permits incomplete Save, not guessed ids or operational success. Preserve an existing Legacy multi-name issue-type filter losslessly until explicitly edited; do not truncate it to one type during capture. New hierarchy rows each select one id.

`legacyIssueTypeNames` is a mutually exclusive compatibility mode, not a second active filter. Non-null preserves the exact captured `get_configured_issue_types()` result: `[]` means no type restriction, while a nonempty array keeps its current name predicate. The original missing/null setting is materialized as its effective `["Story"]` default. In this captured Legacy mode, unresolved type metadata must not block previously valid reads; the adapter retains the captured Legacy type/parent query semantics without rereading environment defaults. Display the captured names (or no type restriction) in the existing row's helper, including any multiple-name filter. Explicitly choosing/removing the planning-type mapping sets `legacyIssueTypeNames:null` in the same draft, even when the selected id is unchanged; that retires the captured predicate and makes id mappings authoritative. Other edits preserve the captured array. Reject this compatibility field for the new model. Empty new-model mappings always mean incomplete, never all issue types. Test all three Legacy capture cases plus explicit same-id replacement and unrelated first-save edits.

Extend `GET /api/issue-types?configurationId=<id>` to return `issueTypes:[{id,name,hierarchyLevel,subtask,iconUrl}]`, preserving raw distinct ids rather than current name-only dedup. Site names and level metadata come from the current `/rest/api/3/issuetype` read; validate project applicability against the selected project metadata. Missing hierarchy/context metadata is unknown, not inferred from literal names. Duplicate names remain separate using the existing technical-id display. Selectable product names are the actual Jira names; labels for the four slots use the expected Jira entities for the model, not stored-name aliases.

Keep the five existing mapped fields plus explicit `projectTrack`/`allocation` rows in the shared form; accept actual standard field ids such as `summary` where the existing picker permits them, not only customfield ids. Required new-model structural mappings are explicit configured issue scope, Sprint/Team/Story Points and planning/parent types; captured Legacy query compatibility above preserves its existing reads until explicitly replaced; Board is optional, as its existing Source control states. A nonempty saved Board selects Board-backed discovery; a blank Board selects the scoped-issue catalog defined below. Ancestor mappings remain optional and their absence does not remove readable rows. `allocation` is new-model metadata and provenance only until an existing calculation explicitly consumes it; do not invent a Legacy Components allocation path or a new investment metric.

Validate generic adjacent ranges with open outer ends, unique ids/names, supported models/types and distinct configured hierarchy ids. Reject nested Capacity/credentials/workspace/user/site authority and malformed ids/JQL. Reuse existing project/string validation; add **no arbitrary 20-project or 64-KiB cap** that could prevent lossless initial capture. A new transport bound must be justified against the full current payload and fail before promotion without truncation.

## Resolution, environment precedence and source of truth

Create `backend/services/work_structure.py`:

```python
normalize_work_configurations(payload: dict) -> dict
resolve_work_configuration(snapshot, *, quarter: str | None,
                           configuration_id: str | None = None) -> WorkConfigurationContext
project_legacy_admin_settings(context: WorkConfigurationContext) -> dict
save_work_configurations(context, bundle: dict, base_revision: int) -> WorkspaceConfigSnapshot
```

`WorkConfigurationContext` is immutable and carries configuration id/revision/model, quarter, digest, scope/hierarchy/fields; no global Capacity values. One viewed quarter matches exactly one inclusive range; a contradictory supplied id is `400 ambiguous_configuration_scope`. All work/Component/backlog use the configuration associated with the accepted dashboard quarter, never the calendar clock. Cross-quarter reports resolve every quarter separately.

Before promotion, retain current Legacy resolution. At first Save, the server materializes the complete effective Legacy settings, including environment-derived Board, Sprint/Story Points/Team/Project Track ids, base/template/stats JQL and legacy project classification defaults. Then apply explicit validated editor diffs under the same revision fence; never lose a deliberate first-save edit. Do not copy credentials or private/group data. Legacy source provenance may be documented but runtime no longer re-reads those global defaults after promotion.

For every configured entry after promotion, explicit saved values win; blank means missing. `JQL_QUERY`, `JQL_QUERY_TEMPLATE`, `STATS_JQL_BASE`, Board/default field ids and product/tech environment variables must not override a configured DELIVERY entry. A valid blank optional field stays blank; required blanks produce `409 configuration_incomplete`. Test with hostile Legacy environment values and a blank new configuration. Never use `or DEFAULT` in the promoted data path.

The single resolver projects old getter shapes and supplies `resolve_effective_catalog_config`, `build_base_jql`, typed project/field getters, `/api/config` Board/projects/readiness, Board snapshot creation, all JQL builders, workers, imports and no-request-context helpers. Explicitly inventory direct `payload.get(...)` readers before removing moved keys. Source guards scan the backend for bypasses; exceptions are only unpromoted Legacy startup and unchanged global Capacity/private settings.

## Atomic storage and rollback

The current DB updater changes one key; it cannot perform the required initial promotion. Implement `save_work_configurations` as a dedicated multi-key repository transaction: acquire the existing workspace advisory fence, read/recheck `baseRevision`, normalize/capture/edit, set `workConfigurations`, remove only moved projects/Board/field/issue-type keys, increment changed entry revisions and workspace revision once, audit and commit. Preserve Capacity keys/verification columns, weights, groups and private state. It is not a public full-workspace replacement endpoint.

JSON currently returns revision zero and has independent full-file writers. Persist server-only `_configRevision` alongside the existing flat file; files without it read as zero, repository snapshots strip it from Admin payloads and every mutation increments it. Use per-path `threading.RLock` plus stable adjacent `fcntl.flock(LOCK_EX)` around fresh read -> revision compare -> narrow mutation -> atomic replace; bounded failure returns `503 config_storage_unavailable`. Do not unlink/recreate the live lock. New bundle writes require `baseRevision`; existing owner writes retain their public API but mutate only their section against the fresh locked document.

Route **all six JSON paths** through that narrow transaction: settings `_persist_shared_section`; group save; Capacity save; EPM save; `jira_server._save_field_config`; config-store legacy-file promotion. Disable stale whole-document replacement once a bundle exists. Existing local promotion may initialize an absent legacy file under the lock; startup never creates a work-configuration bundle. Add two-process, thread and mixed bundle/Capacity/group/EPM races; no DB-to-file fallback.

After promotion, old structural section POSTs return `409 configuration_bundle_required`; GET projections require `configurationId`. Global Capacity/weights/private/group endpoints keep their own policies and sections. The footer chains the revision returned by each successful workspace write and retains failures accurately. Unrelated concurrent workspace changes may legitimately conflict under the existing global revision; do not introduce a new per-section revision architecture.

Project configuration needs no table migration. Initiative review cells **do**, as specified below. For operational rollback, add `scripts/check_work_configuration_rollback.py --input <sanitized-config-file>`: exit nonzero while a promoted bundle exists and explain that older binaries cannot read it. Integrate this preflight into the documented release rollback procedure; do not claim an old binary can protect itself. No automatic flattening. The review migration downgrade separately refuses Initiative rows/layouts. Forward-compatible rollback preserves stored work and fails closed on unsupported models.

## Catalog, bootstrap and metadata contract

A dashboard quarter (`YYYYQn`) is distinct from its Jira Board Sprint record/id. Continue using the existing mapped Jira Sprint field, with an optional source Board. Before live use, Test configuration must verify the actual new Epics expose the configured field with compatible Sprint values and Team/points contexts; verify Board membership only when a Board is selected. The proposal assigns Sprint/quarter to Epics, but no live proof has been gathered here. If Jira metadata rejects it, report the exact setup failure; do not invent another quarter field or claim the test passed. Synthetic development does not wait for live access.

**Security contract for every route row below:** resolve workspace/site/user from current `RequestAuthContext`, validate configuration/source/draft/issue selectors inside that authority and never accept browser workspace/site authority. GET catalog/config/test rows are `authenticated_read`; bundle POST is `shared_admin_write`. Existing Basic/local compatibility stays scoped to its current guards, not a DB-OAuth fallback. All OAuth unsafe methods require `X-Requested-With: jira-execution-planner`; `user_write`, `workspace_write`, `shared_admin_write` and preview policies additionally require the existing token-bound CSRF token. Read-only `authenticated_read` POST options retain their current requested-with-only policy. This header also applies to the write/read matrix below; individual rows name any stricter policy. A 403 never means sign-in recovery; a 401 terminally locks the mounted app.

| Route | Planned contract |
| --- | --- |
| `GET /api/work-structure/config` | Authenticated read; `{workConfigurations,configRevision,userCanEditSettings}`; no Jira call/config write. |
| `POST /api/work-structure/config` | Existing `shared_admin_write`; `{baseRevision,workConfigurations}` -> `{workConfigurations,configRevision,changedConfigurationIds}`. No action/lifecycle. |
| `GET /api/issue-types?configurationId=...` | Authenticated current-workspace catalog with ids/names/hierarchy levels; id-based selected-project metadata validation; unknown metadata explicit. |
| `GET /api/sprints` | Before promotion unchanged. After promotion return merged `sprints` and per-configuration `catalogs` as below; optional `configurationId` reads one source; sourceMode is `board` or `scoped_issues` as explicitly saved. No browser-supplied Board/workspace authority. |
| `GET /api/sprints?configurationId=...&completionAttemptId=...&catalogIdentity=...` | For Board mode, complete only that source's original validated attempt; retain current no-refresh-with-completion rule and attempt bounds. Scoped-issue mode is a synchronous bounded read and rejects completion parameters, not a fabricated DB attempt. `refresh=true` refreshes requested source(s), not every initial read. |
| `GET /api/teams?sprint=...&configurationId=...` | Resolve the requested id through that configuration's authoritative Sprint catalog; membership uses its scope digest; preserve current refresh/completion envelope. |
| `GET /api/config` | One early bootstrap plus configurations/ranges, `adminSettingsMissingByConfiguration`, and per-source catalog identities. Existing global flags describe only selected/restored valid configuration, not an AND across eras. For a blank Board, mark source missing only if explicit scope or mapped Sprint field is missing; Board absence alone is not missing setup. Incomplete DELIVERY must not lock Legacy loading. |
| `GET /api/test?configurationId=...&configRevision=...` | Existing saved-configuration interaction, bounded read-only metadata/access/Sprint-field check. Simple success/error/unknown; sanitize only this new branch and preserve no-selector behavior. Never put project-scoped Test on global Capacity. |

Merged example (synthetic):

```json
{"sprints":[{"id":71001,"name":"2026Q4","configurationId":"legacy","boardId":"7001","sourceIdentity":"sc1:example"}],"catalogs":[{"configurationId":"legacy","configurationRevision":1,"boardId":"7001","sourceMode":"board","identity":"sc1:example","status":"ready","complete":true},{"configurationId":"delivery","configurationRevision":1,"boardId":null,"sourceMode":"scoped_issues","identity":null,"status":"missing","missingFields":["fields.sprint"],"complete":false}],"catalogIdentity":"quarters-v1:example","incomplete":true}
```

Each ready catalog retains validated version/time/browser context and source identity; only Board mode carries DB attempt metadata. DB raw Board Sprint rows remain workspace + positive-decimal Board (`sc1`); do not put fake ids into `WorkspaceSprintCatalog.board_id`, whose CHECK forbids them. The merged identity hashes configuration ids/revisions/ranges and source identities. JSON cache becomes source-keyed entries in its existing generated file with one-time read compatibility for the old Board slot.

**Board-null scoped-issue mode:** add strict `fetch_scoped_sprints(context, auth_context, budget)` in `backend/services/sprints.py`. Build JQL only from the saved explicit scope, stripping existing Sprint/Team clauses through the existing catalog normalizer, then require the configured Sprint field to be nonempty. Fetch that field via captured user Jira context and inspect its structured Sprint records; validate actual id, `YYYYQn` name, state and optional dates. Follow enhanced search `nextPageToken` until explicit `isLast=true`, rejecting malformed/repeated/missing continuation, non-200/auth errors, deadline or existing page ceiling as incomplete. Do not reuse `_collect_sprints_by_jql`'s current partial-on-error success behavior or global stats/project fallback. A complete zero-result scan is a validated empty catalog, not failed setup.

Its identity is `issues-sprints-v1:` plus SHA-256 of workspace/site/auth partition, normalized explicit scope and Sprint-field id; config/range revision still participates in the merged identity. Store only complete matching results in the existing auth-partitioned `SPRINTS_PROCESS_CACHE`, with version/validatedAt/browser context and current TTL/manual-refresh policy; Basic JSON may use its generated source-keyed file. Do not insert issue-mode records into the Board-only DB table and do not add a new table. A process restart/cold authenticated actor must complete the scan again before cached browser rows become authoritative. This deliberately provides no durable cross-user DB cache for Board-null discovery; bound and measure it instead of claiming equal latency. Team refresh/publication must obtain its admitted Sprint record from this matching validated issue-source snapshot rather than `WorkspaceSprintCatalog` (the current publisher requires a Board row). Capture that server-only source evidence before the DB fence, then recheck actor, config digest, source identity/version and deadline inside the fence; do not fetch Jira while holding it or accept browser-supplied Sprint proof. Test Team publication without any Board row and rejection after issue-source/config invalidation.

Issue mode can list only Sprint records observed on accessible issues in that scope. Source helper copy explains: choose a Board to list unused/future Sprints too. Never invent a Jira Sprint id for an unobserved quarter. An existing saved quarter not yet observed receives unavailable guidance and can be restored after explicit refresh/Board selection. Configured-Board failures remain Board source errors, never silently switch to issue-mode identity. Preserve current unpromoted Legacy behavior before bundle promotion. Team membership digest includes effective configuration/hierarchy/field scope. Publish under current fence after actor/config recapture; failed/partial sources never overwrite a complete matching snapshot.

Build displayed choices only from complete authoritative source rows whose quarter belongs to that configuration. Preserve physical Sprint ids, Legacy Board-membership/state/stable-tie dedup and source access checks. Never dedup same names across Boards first. An unknown/ambiguous id fails `409 sprint_catalog_mismatch`; no name-only fallback or numerical-id chronology. One failed source leaves other complete ranges usable. If none is ready, retain pending/202 for Board refresh attempts; a synchronous issue-mode deadline/failure returns its bounded source error (503 when no usable catalog exists), not an endless completion poll; never present an incomplete merged catalog as complete.

API errors are safe schema paths/codes: `400 invalid_work_configurations/invalid_quarter/ambiguous_configuration_scope`; `403 admin_required/csrf_required`; `409 workspace_config_conflict/configuration_required/configuration_incomplete/configuration_scope_changed/sprint_catalog_mismatch`; `503 config_storage_unavailable/catalog_storage_unavailable`. Conflict returns the complete current bundle plus current revision, never empty replacement. OAuth unsafe methods follow the per-policy requested-with/CSRF contract above. Every application `401` uses existing terminal global recovery and never replays writes.

## Queries, alerts, calculations and cache identity

`backend/services/planning_work.py::load_planning_work(context, *, auth_context, quarter, team_ids, purpose, transport) -> PlanningWorkSnapshot` supplies `{configuration, issues, parents, ancestors, operationalChildren, dependencies, completeness}`. Each issue has immutable `issueId`, current `issueKey`, actual `issueTypeId`/`issueTypeName`, own fields and parent id; `issues` are the mapped planning level and `parents` are the mapped next level. No public record stores a fake Jira type. Two adapters normalize levels without relabeling or copying Jira issues. Use the mapped id for each level and existing parent relationship mechanics; preserve incomplete/unreadable parent display. Daily Stories are optional details and excluded from quarterly duplicate totals.

Legacy Department `teamLabels` aliases match Epics; new-model aliases match Initiatives. For every matched Initiative and configured expected Team, check its Epics with that Team in selectedSprint, using the existing actionable-status/missing/outside-sprint distinctions one level higher. Team labels are not required on each Epic and Team/Sprint are not required on Initiative/Objective. Preserve existing group Component/Team scope precedence one level higher; Components remain scope filters, not a new classification scheme. No group-ownership migration or automatic Jira-label copying.

Existing group excluded/Ad Hoc issue-key lists retain literal identities and ownership; their parent-level use shifts Epic -> Initiative for the new model. The picker must admit the mapped actual parent type for the viewed configuration, retaining keys for both eras rather than retyping/deleting them. Existing keys of the other era do not silently become different issues. Capacity itself remains the unchanged workspace source.

For every calculation/alert surface create a before/after fixture pair with identical values/statuses but type ids/parent edges shifted. Assert equal selection, totals, warnings, status buckets, exclusions, Ad Hoc treatment, sorting and dependency outcomes. In particular keep each existing Killed/Incomplete rule; do not create one replacement rule for all surfaces. A new 8-point Epic is counted once in the combined total; no invented Product/Tech split. Initiative aggregation follows the same rule that surface used for Epic aggregation; this computes display/report values and does not introduce a Jira parent-points write. Project Track remains a mapped-parent property: old Epic -> new Initiative, inherited by planning Epics only where Stories previously inherited it. A track edit targets that displayed Initiative's own key; never write it through a child Epic.

Allocation mapping displays new-field value/provenance without redefining established metrics. Readable explicit Epic overrides Initiative then Objective; unreadable intermediate data yields unavailable rather than an authoritative higher value. There is no Legacy allocation configuration. Bound ancestor batching/depth and retain current stricter endpoint ceilings; reuse existing paginated/bounded helpers. Enhanced issue search uses `nextPageToken/isLast`, project search `startAt/isLast`, and Board Sprint discovery its existing validated Agile paging.

| Cache/authority | Required handling |
| --- | --- |
| Tasks, Scenario source, missing-info/alert/readiness caches | Add configuration id/revision/digest and mapped hierarchy, preserving auth/group/Sprint/purpose partitions; clear/retire affected generations after committed configuration save. |
| Dependencies, parent enrichment, per-row refresh and browser task/query caches | Include the effective normalization/field configuration when cached payload depends on it; preserve own-key visibility and incomplete behavior. |
| Completed-Sprint disk stats, cohort, excluded-capacity source/summary, Project Track statistics | Add configuration digest or ordered per-quarter digest list; no file-cache hit across mapped field/type changes. |
| Board index/stream/snapshot/cohort | Capture configuration/hierarchy in scope authority and fresh checkpoints; same payload digest participates in resumed stream rejection. |
| Sprint process/file/DB and Team membership | Per-source identities and scope digests defined above; no single-slot source contamination. |
| `TEAM_FIELD_CACHE`, `PARENT_NAME_FIELD_CACHE`, `EPIC_LINK_FIELD_CACHE` | Replace scalar configuration-dependent lookup with captured fields or site/configuration-keyed metadata; inspect Basic paths even though scalar memos are disabled for DB OAuth today. |
| Projects/Components/labels/Epic-search/issue-type/field catalogs | Site-wide raw metadata remains site/access scoped; project-filtered or mapped projections require configuration identity. Preserve type ids/levels; do not reuse name-only catalog cache. |
| EPM Jira issues/rollups/aggregates | Add configuration digest to existing private EPM/config/auth partitions. Unchanged raw Home metadata remains Home-scope/auth keyed. |
| Global `CAPACITY_FIELD_CACHE`, Capacity proof/source | Remain workspace-capacity/site/mapping keyed; never move to per-project configuration. |

Inventory exact cache callers and the `clear_auth_sensitive_caches` invalidator before implementation; do not claim all caches require identical keys. Preserve startup request counts: one early config/groups pair, needed catalog reads only, no per-issue hierarchy fan-out or test-every-config boot loop.

## Write and persistent-work contract

Every project-scoped write carries an additive `configuration` object `{id,revision,model,quarter,digest}` echoed by its read/source response. Server resolves the quarter, verifies workspace/site, exact current stamp, actual own issue/type and existing mapping/editmeta/baseline checks before mutation. A stamp is a selector/concurrency guard, not authority. A mismatch returns `409 {error:"configuration_scope_changed",configuration:<current safe stamp>}` before Jira PUT/transition. Missing stamp is allowed only for the unchanged unpromoted Legacy path; promoted requests return `400 configuration_required`.

Verified call sites: `backend/routes/eng_routes.py`, `sprint_review_routes.py`, `scenario_draft_routes.py`, `capacity_routes.py`; frontend `jiraIssueApi.js`, `sprintReviewApi.js`, `scenarioApi.js`, `capacityApi.js`. These are the actual paths/builders, not guessed `backend/routes/jira_issue*` modules.

| Actual route / policy | Planned additive shape; retain current fields and guards |
| --- | --- |
| `POST /api/issues/<issue_key>/field` / `user_write`, Jira OAuth only | `{field,value,baseValue,baseUpdated,mappingRevision,configuration}`; update exact-key validator without dropping mapping/baseline. Summary/Team retain stricter DB-OAuth requirement. |
| `POST /api/issues/transitions` / `user_write`, Jira OAuth only | `{issueKeys,targetStatus,configuration}`; validate every own target. |
| `POST /api/issues/priorities` / `user_write`, Jira OAuth only | `{issueKeys,targetPriorityId,configuration}`. |
| `POST /api/issues/project-track` / `user_write`, Jira OAuth only | `{issueKey,targetTrack,configuration}`; resolve field/options on that actual issue. |
| `GET /api/issues/<issue_key>/editable-fields` / `authenticated_read` | Current `field` query plus `configurationId` and `quarter`; return configuration stamp. Preserve Summary/Team DB-OAuth requirement. |
| `POST /api/issues/<issue_key>/user-options` / `user_write` | `{field,query,configuration}`; existing token-bound CSRF applies even though this searches. |
| `POST /api/issues/transitions/options` / `authenticated_read`, Jira OAuth only | `{issueKeys,configuration}`; existing requested-with-only read-option policy. |
| `GET /api/issues/priorities/options` and `/api/issues/project-track/options` / `authenticated_read`, Jira OAuth only | Keep existing optional/required `issueKey` respectively; add `configurationId`/`quarter` when project-scoped. Retain site-only no-issue priority catalog behavior. |
| `PATCH /api/eng/sprints/<sprint_id>/review` / `user_write`, DB OAuth | `{groupId,baseSchemaRevision,baseViewRevision,schemaChanges,cellChanges,configuration}`; unchanged per-cell revisions. |
| `GET /api/eng/sprints/<sprint_id>/review` / `authenticated_read`, current capability | Existing `groupId` query plus configuration selector; extend strict allowed_args. `POST .../review/values/read` / `user_write` keeps `{groupId,issueIds,rowKind}` plus `configuration` and CSRF. |
| `POST /api/scenario/drafts` / `workspace_write`, DB OAuth | `{scope_key,name,overrides,baseDraftRevision,scope}`; `scope.configuration` holds the stamp. Server resolves workspace and shared draft access. |
| `POST /api/scenario/drafts/<draft_id>/reload-from-jira` / `workspace_write`, DB OAuth | `{baseDraftRevision,configuration}`; compare source stamp before loading replacement. |
| `POST /api/scenario/drafts/<draft_id>/rollback` / `workspace_write`, DB OAuth | `{targetVersionNumber,baseDraftRevision,configuration}`; check current draft authority/stamp, preserve target version's original configuration instead of relabeling it. |
| `PATCH /api/capacity/<issue_key>` / unchanged `user_write` | Keep `{sprintName,teamName,expectedCapacity,capacity}`, workspace mapping verification and OAuth scope checks; **no** project configuration selector. Existing `POST /api/capacity/config` stays `shared_admin_write` with its own mapping/revision body. |


Register adapted call-site pins before edits; retain user OAuth, requested-with, CSRF, issue rights and batch bounds. Update both frontend builders and backend strict allowlists. Configuration correction during an editor operation must preserve draft and reject stale submission; never redirect a child write to a parent. No EPM/Home mutation or new Scenario writeback capability is added.

Current review persistence cannot represent Initiative: `GroupReviewCell.row_kind` has `String(8)` and a Story/Epic-only CHECK; authorization also classifies by literal name/level. Plan one forward Alembic migration after current head to widen the column to 16 and add native `initiative` to the CHECK. Preserve existing ids, uniqueness, values, revisions and group ownership byte-for-byte. Extend schema/layout/derived-column validators, API allowlists, authorization by configured type id/level and UI labels to actual Story/Epic/Initiative kinds. New Initiative/Epic rows use their true kinds; do not encode an Initiative as Epic or copy old Epic/Story cells to different issues.

Existing custom-column sums/downward values shift Initiative/Epic exactly as existing Epic/Story behavior, including complete-children loading gates. Keep existing row/group caps, pinned columns and archival semantics. New view inheritance uses validated quarter order within compatible configuration/type mapping, not arbitrary Sprint-id order; preserve Legacy behavior. The migration downgrade refuses any Initiative cells **or** Initiative schema/layout JSON before altering constraints. Test SQLite batch migration, PostgreSQL upgrade/downgrade refusal and old-row parity.

Unstamped Scenario sources read as Legacy without write-on-read; next explicit save stamps them. Reload/rollback never reinterpret old overrides by current type mappings. Exports/share links carry the admitted configuration and actual Jira names. EPM retains private Home scope/exact labels; Legacy private type presets keep current precedence, new-quarter Jira type mappings come visibly from workspace configuration while private values remain unchanged. No editable-looking ignored EPM control.

## Implementation tasks and verification

Read [ontology](../ontology.md), [ownership](../../backend/security/CONFIGURATION_OWNERSHIP.md) and related postmortems [catalog](../postmortem/MRT030-sprint-catalog-page-limit.md), [review layouts](../postmortem/MRT033-review-columns-hidden-after-migration.md), [startup](../postmortem/MRT010-startup-api-load-fanout-and-overscoped-payloads.md) and [sticky tiers](../postmortem/MRT009-sticky-layering-regressions.md). Verify each named existing file/symbol and current Alembic head before editing. Test-first steps below describe intended evidence, not completed implementation.

### Task 1: Multi-key storage, ranges, resolver and defaults

**Create:** `backend/services/work_structure.py`, `tests/test_work_structure.py`, `tests/test_work_structure_storage.py`, `scripts/check_work_configuration_rollback.py`.
**Modify:** `backend/config/shared_config.py`, `backend/services/workspace_dashboard_config.py`, `backend/config/db_repository.py`, `json_repository.py`, `import_config.py`, `backend/config_store.py`, `jira_server.py` configuration wrappers, `.gitignore` for the generated lock only. Add `workConfigurations` to Admin/private-forbidden ownership gates; no Capacity schema change.

- [ ] Add failing tests for initial and alternate valid adjacent ranges, open bounds, gap/overlap, incomplete Save, model/name independence, lossless oversized Legacy capture and exact env materialization. Assert configured DELIVERY blanks cannot consume hostile global defaults.
- [ ] Implement dedicated multi-key DB transaction and persisted JSON revision/narrow locks across the six writers. Test mixed Capacity/group/EPM/bundle writes in two threads/processes/workspaces, initial capture plus deliberate editor patch, rejected stale revisions and no partial promotion.
- [ ] Trace every moved-key reader; supply one context/projection through catalog/bootstrap/global getters/workers. Add a whole-backend bypass guard with documented startup/global-owner exceptions. Implement executable rollback detection; test promoted bundle nonzero, restored legacy zero, no mutation.
- [ ] Run `.venv/bin/python -m unittest tests.test_work_structure tests.test_work_structure_storage tests.test_workspace_dashboard_config_service tests.test_config_jsonfile_fallback tests.test_shared_capacity_config_db`.

### Task 2: Route and UI contracts, real editable hierarchy

**Create:** `backend/routes/work_structure_routes.py`, `frontend/src/settings/WorkConfigurationsEditor.jsx`, `useWorkConfigurationSettings.js`, `tests/test_work_structure_routes.py`, `tests/test_work_structure_settings.js`, `tests/ui/work_structure_settings.spec.js`.
**Modify:** `backend/app.py`, `backend/security/policy.py`, `backend/routes/settings_routes.py`, `diagnostic_routes.py`, `jira_server.py::test_connection`; `frontend/src/settings/AdminSettingsContainer.jsx`, `AdminSettingsTabs.jsx`, `JiraFieldSettings.jsx`, `useJiraFieldPickers.js`, `useJiraProjectSettings.js`, `useSharedConfigSave.js`, `workspaceConfigConflict.js`, `frontend/src/api/configApi.js`, dashboard composition, `docs/design-system.md`; fixture/controller/build-script only to match accepted controls.

- [ ] Extend current issue-type catalog to retain id/level/project applicability; mount one existing-style picker for each Jira-name row and Project Track/Allocation fields. Test duplicate names, null metadata, optional blank, renamed type, no text-driven model flip and preserved project visibility. Update previews from mapped actual names, not static Story text.
- [ ] Implement exact upper/nested layout, independent patch-only drafts, normal Save, existing dirty Cancel confirmation, field-local range/name errors, saved-only simple Test and no project Test on Capacity. Test rename-then-edit, in-place range correction, upper/nested switches, long names/mobile drawer and menus with normal clicks.
- [ ] Backend tests cover explicit edit grant, workspace/site isolation, unknown authority/fields, CSRF/requested-with, 403 vs global 401, partial footer saves and revision chaining with unchanged global Capacity. Guard old structural setters and imports; keep unrelated endpoints scoped.
- [ ] Run route/unit suites, `npm run build`, then `node --test tests/test_work_structure_settings.js tests/test_use_shared_config_save.js tests/test_config_api.js` and `npx playwright test tests/ui/work_structure_settings.spec.js --browser=chromium --workers=1`; capture settled desktop/mobile proof.

### Task 3: Two-source catalogs and cache authority

**Create:** `tests/test_work_structure_catalogs.py`, `tests/test_work_structure_cache_identity.py`, `frontend/src/workStructure/configurationContext.js`, `tests/test_configuration_context.js`.
**Modify:** `backend/services/workspace_catalog_config.py`, `workspace_catalog_cache.py`, `catalog_refresh_runtime.py`, `catalog_app_adapter.py`, `sprints.py`, `sprint_teams.py`, `stats_cache.py`; settings/ENG routes, `jira_server.py` memo/cache helpers, `frontend/src/api/jiraCatalogApi.js`, `configApi.js`, `frontend/src/settings/useTeamCatalogLifecycle.js`, `frontend/src/eng/engSprintSelectorState.js`, dashboard composition.

- [ ] Implement catalog route matrix including JSON Board-keyed cache compatibility, per-source completion, merged identity and per-configuration readiness, plus explicit Board-null issue source identity/completeness/cache policy. Test same quarter on two Boards, reversed numeric ids, inaccessible/missing one source, complete empty results, stale publication and changed mappings with same Board. For Board-null mode test complete/empty scan, malformed Sprint field, pagination error/timeout, cold process revalidation, observed-only quarters, hostile env rejection and no fake DB Board id.
- [ ] Resolve Sprint ids only through admitted authoritative source rows; test no name/env fallback. Preserve all current Legacy dedup tests. New metadata test must reach actual field/context validation when run live; synthetic tests cannot establish Epic Sprint support.
- [ ] Cover every cache-table row, Basic scalar memo paths and backend/browser stale response races. Preserve unchanged global Capacity/raw Home keys. Measure initial requests; one config/groups pair and bounded needed catalog reads only.
- [ ] Run `.venv/bin/python -m unittest tests.test_work_structure_catalogs tests.test_work_structure_cache_identity tests.test_workspace_catalog_config tests.test_sprint_service tests.test_sprint_team_service`; configuration-context/early-bootstrap/Sprint-selector frontend tests after build when needed.

### Task 4: One-level calculations, Initiative labels and shifted alerts

**Create:** `backend/services/planning_work.py`, `tests/test_planning_work_profiles.py`, `tests/test_work_structure_consumer_inventory.py`, `tests/fixtures/work_structure_reference.py`.
**Modify:** `jira_server.py` queries/enrichment, `backend/routes/eng_routes.py`, `eng_board_routes.py`, `backend/services/eng_board.py`, `group_config.py`, `story_readiness.py`, `alert_epics.py`; frontend hierarchy/ENG tasks/Board/alerts/planning/capacity classification modules, `futurePlanningTeamUtils.mjs`, relevant Department label/issue-key picker copy and validators.

- [ ] Use paired fixtures for all existing calculations/status/exclusion rules and all alerts, shifted Story/Epic/Initiative -> Epic/Initiative/Objective. New Initiative sum must equal the old Epic sum on each surface; test Killed/Incomplete/Ad Hoc/excluded inputs without a new universal filter or effort field.
- [ ] Verify Initiative labels expect each mapped Team's selected-Sprint Epic; missing, outside-Sprint, non-actionable and unestimated cases shift exactly. The presence or absence of daily Stories is irrelevant to this check. Preserve Team alias/group ownership and existing Component/Team scope priority.
- [ ] Migrate Catch Up, Planning List/Table, Board scopes/streams, backlog/per-row refresh, missing info, dependency/lookup/alerts, exports/Jira links and EPM sources. Guard hard-coded `Epic`/`Story`/`Team[Team]` JQL in promoted paths, with one documented captured-Legacy-name compatibility branch; use captured mapped ids/fields. Include no-request-context real OAuth-wrapper worker tests and bounded hierarchy hydration.
- [ ] Update the complete-readiness projector’s Product/Tech-only class and access gates (`story_readiness.py::_normalize_input`, `_PROJECT_CLASSES`) for the new single selected-project `other` scope; do not require both legacy project classes to be accessible. Prove one accessible new project produces complete Initiative/Epic readiness while inaccessible/partial scans never claim missing Epics.
- [ ] Reuse `other`, test one combined 8-point total with zero automatic Product/Tech attribution and no hidden stored projects. Run hierarchy/task/selection/capacity/alert frontend and corresponding Python fixture/source-guard suites.

### Task 5: Writes, Initiative review migration and stored Scenario work

**Create:** `tests/test_work_structure_write_guards.py`, `tests/test_work_structure_reviews.py`, `tests/test_work_structure_scenario.py`, `tests/ui/work_structure_transition.spec.js`; one forward Initiative review migration after verified head.
**Modify:** `backend/db/models.py`, `backend/services/sprint_review.py`, `backend/routes/sprint_review_routes.py`, `backend/routes/eng_routes.py`, `backend/services/jira_issue_field_edits.py`, `jira_issue_transitions.py`, `jira_issue_priorities.py`, `jira_issue_project_track.py`, `backend/scenario_drafts.py`, Scenario routes, export route; corresponding inline-edit/review/Scenario API builders/hooks, `planningReviewTableModel.js`, share resolver/codec and `jiraExportUtils.mjs`.

- [ ] Implement every request-table shape and backend strict allowlist plus 409 body; retain baseline/mapping revisions. Test wrong/missing stamp, correction during edit, every batch target, actual own-key/type/permissions, 401/403 and zero Jira mutation on conflict. Global Capacity request remains unchanged.
- [ ] Execute Initiative String/CHECK migration, extend literal authorization/type-level logic and schema/layout/derived columns. Prove unchanged old rows, correct Initiative/Epic review and no cross-issue value copy; test SQLite/PostgreSQL and downgrade refusal for Initiative cells or layout/schema JSON.
- [ ] Stamp saved Scenario sources, preserve unstamped Legacy reads and original version/reload/rollback interpretation. Test malformed scope/workspace ids, config corrections and preserved overrides. Share/export reflects actual Jira entities and recipient authorization.
- [ ] Run focused write/review/Scenario/security suites and transition browser spec, including valid quarter switching with populated saved work.

### Task 6: Statistics, EPM, docs and complete verification

**Create:** `tests/test_work_structure_stats.py`, `tests/test_work_structure_epm.py`, `tests/test_work_structure_analytics.js`, `tests/ui/work_structure_stats_epm.spec.js`, `docs/features/quarterly-work-structure.md`.
**Modify:** stats/cohort services/routes/UI, EPM Jira rollup/issues/payload/routes/UI, analytics schema/taxonomy, ownership/design-system/ontology/contributor docs, plan/design/index and actual reviewed mockup captures. Update only affected extraction budgets/digests.

- [ ] Partition ranges by configuration, preserve one-level calculation rules and separate unlike issue-count/time units. EPM keeps private Home/exact labels and Legacy custom types, shows workspace mapped Jira names for new periods, and filters Epics by selectedSprint rather than requiring daily Stories. Preserve all private storage values and metadata-only cards.
- [ ] Negative tests forbid Basic/service/local-token/Home-write fallbacks in DB OAuth and Jira mutation from read/test/config routes. Keep current Home query/scope behavior; no auth migration is implied.
- [ ] Reuse settings_action with section `work_configurations` and existing safe action/result buckets. Existing quarter/filter events remain; no draft churn/type names/ids/JQL/digests. Add `initiative` actual issue kind only where existing edit/review events need it; preserve two GTM triggers, GA4_ENABLED, logical pages and no consent UI/custom-dimension bulk registration. Update taxonomy/runbook only for actual contract changes.
- [ ] Document actual-name glossary, generic ranges, capture/default precedence, catalog identity, one-level semantics, global owners, Initiative migration and honest live-history limits. Before publication use required exact-head verification and authorization; do not mark this EXEC done for design/mockup-only delivery.

## Acceptance and evidence limits

Required checks: corrected same-picker hierarchy + preview; editable reachable ranges; patch-only rename preservation; unchanged global Capacity; lossless multi-key promotion/JSON revision races; hostile env/no fallback; per-source catalogs/readiness; cache invalidation; every write stamp; golden one-level calculations/alerts; Initiative review migration; Scenario history; private EPM precedence; desktop/mobile menu/geometry and current Cancel behavior.

Use pinned runtimes and installed local dependencies. Do not install packages or inherit ancestor node_modules to claim reproducible build. Build before tests reading `frontend/dist`; keep scratch/generated fixture bundles ignored. Worktree servers must not use main/OAuth port 5050.

```bash
npm run build
python3 -m unittest discover -s tests
npm run test:frontend:unit
npx playwright test tests/ui --browser=chromium --workers=4
python3 -m unittest tests.test_agents_md_learnings tests.test_codebase_structure_budgets
```

Also run configured PostgreSQL migration/concurrency checks, startup preflight and this checkout's verified `/api/test`; headed Firefox/WebKit geometry guards when affected. Source proposal [RnD work structure for 2027+](https://criteo.atlassian.net/wiki/spaces/~i.moldovan/pages/5492835223/RnD+work+structure+for+2027), v41, was read during initial investigation; actual live Epic Sprint field/project contexts remain unverified. No generalized claim that Epics cannot carry Sprint is accepted without evidence. Test real metadata before deployment; do not ask for credentials while safe local evidence remains available.

[GATE-05](GATE-05-home-write-capability.md) remains blocked/write-only, next due 2026-11-02 Europe/Berlin. No approved target/PASS change was supplied, so its in-window file stays untouched. Current [Home public-read](SUPPORT-home-oauth-public-read-design.md) and [setup](../SUPPORT-atlassian-oauth-setup.md) contracts remain; this plan creates no Home auth/write capability.

## Outcome and current accuracy

The design, implementation contract, fixture and optional Settings presentation extension have been revised. Application configuration integration, backend/database migrations and the proposed runtime tests remain unimplemented. Current fixture and backward-compatibility verification is recorded in the [design](SUPPORT-quarterly-project-configurations-design.md). Those checks do not establish live Jira contexts, storage concurrency, PostgreSQL migrations or production quarter switching.

The six operator decisions above supersede earlier fixed-range validators, implicit type/model switches, invented Work Area/Legacy allocation, `unclassified` enum, new effort/alert behavior and read-only-only Initiative review proposals. Remaining work is concrete implementation/live metadata verification, not an invitation to reopen settled business choices. Update this contract if source paths change; report actual commands/results and residual blockers before claiming completion.
