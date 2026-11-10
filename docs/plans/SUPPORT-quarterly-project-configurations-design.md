# Quarterly project configurations design

> **Status:** Accepted planning basis, 2026-10-30. D1–D9 are final; the owner’s subsequent “proceed” is taken to accept the listed D2/G1/G9 defaults and authorize the implementation plan. Application implementation, migrations, commits and publication have not started. The round-2 fixture evidence below remains historical evidence for that revision, not feature support.

## Meaning and scope

**Project configuration**, **work configuration**, **work structure** and the **Project config** Admin tab refer to the same ranged configuration feature. A dashboard Sprint means a quarter (`YYYYQn`); a Jira Board Sprint id is the physical source identity. Legacy initially ends at `2026Q4`; DELIVERY initially begins at `2027Q1`. Those are editable defaults, not locked validators.

The display name DELIVERY, stable configuration id `delivery`, internal model `rnd_2027` and a selected Jira project key such as the synthetic `PLAN` are distinct. Renaming an entry or Jira type does not change its model, projects or classification. Use actual Jira type names in controls and previews, with these initial mappings:

| Setting | Legacy | DELIVERY |
| --- | --- | --- |
| `planningIssueTypeId` | Story | Epic |
| `parentIssueTypeId` | Epic | Initiative |
| `ancestorIssueTypeId` | Initiative | Objective |
| `optionalAncestorIssueTypeId` | Unmapped | Strategy, optional |

Mappings select one Jira id per row. Metadata carries id, name and hierarchy level. The table shows initial entity defaults, not permission to replace a captured Legacy filter. Captured Legacy has non-null `legacyIssueTypeNames` and `planningIssueTypeId=null`; preserve single/multiple names or an unrestricted empty array exactly. Exact-name parent/ancestor capture supplies server-owned display-only `legacyDisplayTypes` metadata, null if ambiguous; those display values never become query filters. Hierarchy ids become authoritative only when the administrator explicitly edits that row. Explicit confirmed replacement or removal of the planning-type row retires `legacyIssueTypeNames`; parent/ancestor edits do not. The execution contract preserves each task, Statistics and Board reader's existing `[]` semantics. Planned `legacyHierarchyModes` persists `compatibility|mapped` independently for parent and ancestor. Selecting/removing a slot flips it to mapped; mapped null remains an explicit clear through Save/reload and unrelated changes. Required parent clear makes the configuration incomplete; optional ancestor clear only disables enrichment. Planning-filter authority remains separate. Evidence: [`get_configured_issue_types`](../../jira_server.py#L2674), [`resolve_issue_type_ids`](../../backend/services/eng_board.py#L268), and the current literal Initiative/text-replacement paths in [`jira_server.py:2940–2985`](../../jira_server.py#L2940).

This feature is **DB/OAuth only**. Wider removal of local JSON/Basic code is a separate prerequisite/sibling, not work added here. The recorded OAuth-only and separate-extraction direction is in [App decomposition:23–26](DONE-dashboard-app-decomposition.md#L23); no dedicated executable removal plan was found in the current plan index. Keep that absence explicit instead of claiming the extraction already ran. Unsupported feature routes/readers return `409 work_configuration_setup_required`, with a safe DB-backed OAuth setup message and zero local/credential fallback. Existing unrelated paths are not removed by this feature.

## Owner decisions D1–D9

| ID | Settled contract | Current source / required proof |
| --- | --- | --- |
| D1 | DB/OAuth workspace multi-key update under the existing fence. No JSON revision, file locks, JSON Sprint cache or Basic acceptance matrix in this feature. | [`load_dashboard_config_snapshot:1830`](../../jira_server.py#L1830) still has both storage paths; production feature guards and DB tests remain planned. |
| D2 | Scenario rebuild is deferred to the separately recorded issue 230 scope. No Scenario configuration stamps or history migration task here. | [Existing deferral:23](DONE-dashboard-app-decomposition.md#L23); proposed fail-closed treatment is below. |
| D3 | Review definitions, values and layouts never cross from Legacy into the new Epic rows. Choose explicit configuration namespaces and quarter order, not numeric Sprint-id order. | [`row_kind:83`](../../backend/services/sprint_review.py#L83), [`resolve_view:362`](../../backend/services/sprint_review.py#L362); migration described below. |
| D4 | New totals are combined, using `other`; Ad Hoc/Excluded parent keys are Initiatives selected through the existing Department picker. No Product/Tech subtype for `other`. | Current [`classifyCapacityIssue:20–39`](../../frontend/src/capacityClassification.mjs#L20) forces Product for Ad Hoc/unknown; paired tests and consumer changes remain planned. |
| D5 | Verify Epic Sprint/Team/Story Points before live use without blocking development. Keep missing points null internally, display `0 SP`, and preserve each current calculation's treatment of missing/zero/status values. | Source v41 establishes intended fields; actual tenant contexts remain unverified. Mixed/empty Epic fixtures and current calculation oracles are required. |
| D6 | No saved/captured base JQL, Team template, Stats JQL or order fields. Existing global query precedence remains unchanged in both eras. | [`build_base_jql:1924`](../../jira_server.py#L1924) returns `JQL_QUERY` before project chips; set/unset tests must prove that rule. |
| D7 | Preserve `deduplicate_sprints_by_name` and existing source-cache semantics; no id union, new cold worker or duplicate-name setup error. | [`sprints.py:154–176`](../../backend/services/sprints.py#L154). Only the retained id is used; Epics on another same-named Sprint id may be absent. |
| D8 | Legacy precedes DELIVERY. Validate strict uppercase, unpadded `YYYYQn`, supported year bounds, ordering, complete adjacent coverage and no overlap/gap. Show the offending field/row; a reversed configuration order is invalid. | Revised fixture must reach a different valid boundary and correct invalid edits in place. Moving the boundary changes which configuration interprets those quarters. |
| D9 | Operations require exactly one DELIVERY Jira project. Zero projects may save as an explicitly incomplete configuration with a warning; more than one is invalid. A second Add reports `DELIVERY uses one Jira project`; Enter adds with `other`. Changing project preserves the Board selection; Test reports an incompatible saved Board. | Current default Add uses Product in [`useJiraProjectSettings.js:231`](../../frontend/src/settings/useJiraProjectSettings.js#L231); production correction and test belong to Task 2. |

`JQL_QUERY`, `JQL_QUERY_TEMPLATE`, `STATS_JQL_BASE` and `STATS_JQL_ORDER_BY` remain global. `JQL_QUERY` overrides project chips in **both** eras; a configured global query can therefore restrict or widen their intended business scope. It is not captured into a configuration or returned as a new Settings field. Narrow “no environment fallback” to promoted per-configuration Board, Sprint/Story Points/Team/Project Track/Delivery owner/Allocation field ids and hierarchy ids. First Save materializes effective Legacy Board/field defaults once, then applies explicit editor diffs under the DB fence; subsequent missing saved values stay missing.

## Settings and specimen contract U1–U10

Keep the approved navigation and one real Settings footer:

```text
Admin
├─ Project config
│  ├─ Left: Legacy / DELIVERY, selected-row inline name
│  └─ Right: name/range summary
│     └─ Scope / Source / Field mapping
├─ Capacity
├─ Priority weights
├─ Access
└─ Performance
```

Only Project config owns the list and nested tabs. Global panels hide that chrome. Capacity storage, numeric-field proof, endpoint and editor remain global; priority weights, access, performance, collaborative Department groups and private EPM/preferences retain their owners. The fixture demonstrates their placement without pretending to implement those global panels.

| ID | Visible requirement / specimen | Production boundary |
| --- | --- | --- |
| U1 | Distinguish resolved, unmapped, unresolved saved id, loading and metadata error. An unresolved saved value displays its raw id and `Not found in Jira`, retains Remove and counts incomplete in Test/feedback. | Do not convert a stale id to a blank or a successful live check. |
| U2 | Show the captured Legacy single/multiple/unrestricted filter, and confirm before replacing it through the planning-type row. Cancel preserves it; unrelated edits do not retire it. | Per-consumer compatibility remains until that explicit replacement. |
| U3 | Use the per-view setup messages below, without automatic Settings navigation. | Do not reuse bootstrap navigation behavior as authorization to redirect an already mounted view. |
| U4 | Include first-open blank DELIVERY, zero-project incomplete Save with a named warning, and selected-quarter setup-guidance specimens; never claim readiness for a blank entry. | Saving the bundle applies all configured quarters immediately; no activation lifecycle is added. |
| U5 | Feedback names the configuration and missing row (`DELIVERY: missing Epic, Initiative`); optional ancestors are not reported as required. Saved feedback stays visible on upper tabs; clear stale test results on edits/context changes. Dirty count uses production Settings sections, not number of configurations. Name/range errors stay at their inputs. | One footer Save, accurate partial success and preserved failed drafts. |
| U6 | Picker empty state says `No matching issue types at this level`. A saved unknown-level type stays unresolved; do not offer unknown/null-level candidates as a proven compatible selection. Duplicate names show visible ids. Project Track/Allocation type compatibility is a Test result when metadata is available; missing schema is unknown, not success. | Field/id validation and sanitization are planned; synthetic catalogs do not attest real contexts. |
| U7 | Inspect mobile touch targets, close-label contrast and scrollable Admin tabs at 375/768 widths. Fixture CSS may demonstrate the target. | Actual shared CSS repair belongs to Task 2 and needs production Playwright proof; fixture CSS is not that repair. |
| U8 | One right-pane scroll owner includes ranges plus forms at 375×667, 667×375 and 1024×600; Save/Cancel remain reachable. | Avoid nested independent range/form scrollers. |
| U9 | Use exact Department row markup/hooks, without a separate `data-config-select` or flex-equal nested-tab override, unless a named variant is registered. | Registry and regression guards must match the actual reused row. |
| U10 | Guard Source/Scope/Mapping default markup when the six new optional props are omitted. | Today the guard is `tests/test_jira_field_settings_default_markup.js`. Production destructuring of six props plus ledger count/ceiling from 152 to 158 must land together in Task 2; neither is claimed fixed by this no-app-code revision. |

Required/optional row labeling in Task 2 is explicit: project scope, Sprint, Story Points, Team and planning/parent types are required for operational new-model reads; Board, parent-name display mapping, Project Track, Delivery owner, Allocation, Objective and Strategy are optional. Captured Legacy planning-name compatibility satisfies its existing type requirement without an authoritative single-id selection. Use `(required)` / `(optional)` consistently in the production row labels; the unchanged shared renderer's unqualified field labels remain a named Task 2 presentation correction, not a fixture-verified production fix.

The [specimen](../../assets/mockups/quarterly-work-structure-settings.html) and [controller](../../assets/mockups/quarterly-work-structure-fields.jsx) reuse the actual `SettingsModal`, `JiraFieldSettings` and picker helpers. Local code supplies synthetic state, list/ranges and specifically labeled missing-catalog/first-open examples. Shared renderer extensions remain opt-in; default callers must pass the omitted-props guard. Dirty Cancel uses the actual modal confirmation, Keep editing preserves edits, and Discard restores the complete accepted baseline. Field callbacks apply patches to the current parent draft, so a subsequent edit cannot overwrite a rename.

```bash
node scripts/build_work_structure_mockup.cjs --serve
```

Use this checkout's pinned Node 20 dependencies and an unused preview port (`--port=5063` if needed). The allowlisted local server serves only the specimen, generated ignored controller and existing styles. It makes no application API request, writes no saved app configuration and emits no analytics.

## Quarter/setup behavior

Before a bundle exists, GET returns a virtual Legacy editor built by pure projection of one DB-only snapshot and applicable Board/field defaults (no ambient config/field/Board getters or fallback-backed request cache) plus the proposed blank DELIVERY entry. This virtual read performs no Jira I/O; type metadata stays unresolved until its catalog is loaded. Prefetch any required bounded metadata outside the DB fence, then recheck the same candidate/auth authority inside the save transaction; never hold the fence during Jira I/O. A full POST distinguishes server-captured/echoed values from explicit edits and clears; an echoed empty default cannot erase selected projects or effective Legacy fields. Existing first-run section handling remains unchanged before promotion, including while the release flag is on; that explicit guide does not implicitly promote. After promotion explicit setup uses the configuration editor/bundle, while quarter changes never auto-start the guide or open Settings. After promotion private selectedQuarter is independent of nullable physical Sprint admission; setup requirements come from its saved configuration. The existing selector offers observed quarters plus private/current/next/boundary quarters and exact canonical search. Unobserved rows have no Jira id and show setup/not-observed guidance. Source removal/restoration never silently replaces an explicit quarter with Legacy. Only Sprint-bound reads need physical admission; existing all-history modes still use quarter solely to select configuration. The plan defines initial-default precedence and preserves v1 share-link encoding. Bootstrap `/api/config` returns compact names/ranges/revisions without inventing a quarter or issuing Jira work for both eras.

A server feature flag defaults off. Before promotion, an unpromoted seed is inert and the old editor/runtime stays active; the bundle cannot remove old structural keys while readers still bypass it. The fenced first Save stores immutable server-owned `promotionRevision`; disabling the flag after promotion fails closed across restarts and never restores flat/environment readers. The feature flag is not a rollback mechanism. Current workspace rows have no existing promotion marker (`backend/db/models.py:246–258`), and unrelated settings share the workspace revision (`workspace_dashboard_config.py:164–218`). Final integration enables the feature only after the generated reader/JQL inventory has an empty bypass allowlist and its guards pass. This is an internal release switch, not another UI state or activation flow. After promotion, a required-but-missing quarter yields `409 configuration_required`; a partial old structural writer yields `409 configuration_bundle_required`.

Use the following state-specific copy; interpolate only the accepted display name, quarter and actual missing Jira names. Permission guidance supplements the cause rather than replacing it with an empty view. These states never navigate automatically.

| State | Exact example copy |
| --- | --- |
| Required mapping missing | `DELIVERY is incomplete: map Epic and Initiative in Project config.` For a field, use its actual name, for example `DELIVERY is incomplete: map Sprint in Project config.` |
| No usable configured source | `DELIVERY has no usable Sprint source. Review Source in Project config.` This is not a declaration that an optional Board is mandatory. |
| Quarter unobserved in a complete source | `2027Q1 was not found in DELIVERY's configured Sprint source.` Do not use this for loading, denied access or an incomplete response. |
| Authenticated non-editor | `You cannot edit workspace settings. Ask an authorized settings editor to complete DELIVERY.` Keep the underlying missing-row/source cause visible and offer no editable Admin controls. |
| No tool-admin contact available | `No tool administrator contact is available. Contact your deployment operator.` Do not invent a person or infer Atlassian tenant-admin authority. |
| Feature unavailable outside supported deployment | `Project configurations require DB-backed OAuth. Contact your deployment operator.` No credentials or local fallback are requested. |

| Surface | Safe guidance for a missing mapping/source/unobserved quarter |
| --- | --- |
| ENG Catch Up | `DELIVERY is incomplete: select the Epic and Initiative mappings.` Keep the chosen quarter visible, avoid false empty results and show no alerts from incomplete data. |
| Planning | Show the same configuration/row-specific cause; do not calculate missing rows as zero work or silently load Legacy. Preserve unrelated mounted state. |
| Board | Hold correctly labeled prior data only under its old identity, disable stale writes and show that the requested configuration/source is unavailable. No fallback to a different Sprint id. |
| Statistics | Mark the affected period unavailable, with separate correctly labeled supported periods; do not manufacture a zero/comparable series. |
| EPM | Keep authorized Home metadata/metadata-only cards; mark the affected Jira portion unavailable. Preserve private Home scope and labels. |
| Unobserved quarter | `No Sprint for 2027Q1 was found in DELIVERY's saved source.` Distinguish complete absence from loading/access/error. |
| Non-editor / no named tool admin | Explain that an authorized editor must complete configuration; show existing safe admin-contact guidance when available, otherwise `Contact the workspace's tool administrator.` No automatic modal opening or fabricated contact. |

Optional missing fields affect only their dependent control/report. The existing unconfigured-workspace notice may be reused only where its behavior matches these states. A terminal application `401` keeps the existing same-tab recovery and does not replay failed writes. **Accepted G9 default:** retain the current hidden Admin tab for non-editors rather than promising an unimplemented saved-value inspector; [`useSettingsModalState.js:283–286`](../../frontend/src/settings/useSettingsModalState.js#L283) already filters it by the server edit grant.

## Reviews: configuration and native Jira type are separate identities

**Chosen D3 storage direction:** add nullable `configuration_id` and nullable `quarter_ordinal` to the relevant review schema/view ownership. NULL is the retained Legacy namespace; a new configuration uses its stable id. Cells remain under their schema and actual native row kind. Enforce one Legacy namespace with appropriate uniqueness constraints rather than relying on SQL NULL equality. New inheritance uses validated quarter ordinals inside that namespace, never numeric Sprint ids or another configuration. Range edits do not move saved schemas/cells/layouts into a different namespace.

| Namespace | Story | Epic | Initiative |
| --- | --- | --- | --- |
| Legacy / NULL | Existing child rows | Existing parent rows | Context only |
| New configuration id | Optional operational detail, not quarterly review rows | New child rows with new definitions/layouts | New parent rows |

The operational assumption is that Legacy Epics close in the final Legacy quarter; this app feature does not close them or copy their review data. Old Epic column definitions/values/layouts must never become columns of a new Epic merely because the native type name is the same. Update `REVIEW_LAYOUT_BUILTINS` by parent/child role within each namespace, including renamed parent-link columns and derived markers/rollups. Authorize actual mapped ids/hierarchy levels through current-user Jira access. Preserve current request/read/change budgets. Allow at most 30 active columns per native kind within a configuration namespace, while retaining the existing hard caps of 240 total columns per Department group across all namespaces (including archived definitions) and 500 views per group across all namespaces. Namespace separation must not multiply those group-wide guards; enforce aggregate counts under the shared group save lock. Do not merge eras to share a schema.

Current evidence is [`sprint_order:33–35`](../../backend/services/sprint_review.py#L33), [`row_kind:83–85`](../../backend/services/sprint_review.py#L83), [`REVIEW_LAYOUT_BUILTINS:238–255`](../../backend/services/sprint_review.py#L238), [`authorize_issues:261–322`](../../backend/services/sprint_review.py#L261), and [`resolve_view:362–372`](../../backend/services/sprint_review.py#L362). A forward migration must widen the Initiative kind, update CHECKs/uniqueness/schema/layout validation and preserve populated Legacy data. Test range edits, existing cells/hidden columns, reversed physical Sprint ids, no cross-era definition/value/layout inheritance, and refusal to downgrade while new kinds/namespaces exist. This migration remains planned.

## Calculations, combined totals and global capacity

D4/D5 preserve each current formula, status, Killed/Incomplete, selection, grouping and exclusion rule with Story→Epic, Epic→Initiative and Initiative→Objective inputs. An Initiative's displayed Story Points sum follows the same surface rule as the old Epic sum; it is not a Jira parent-points write. Missing points remain null internally and display `0 SP`; missing/zero hygiene behavior remains a separate check. Use paired empty/mixed-status/missing-point fixtures, not a new universal status filter or effort field.

For combined totals, `classifyCapacityIssue` returns `{projectType:'other',capacityType:'other',productSubtype:null}` for ordinary work, and `{projectType:'other',capacityType:'ad_hoc',productSubtype:null}` for an Ad Hoc Initiative's Epic. Exclusion stays in the existing owning filter/calculation, rather than inventing a new Product subtype. Epic rows use their Initiative key for existing Department Ad Hoc/Excluded membership. The same picker admits configured Initiative types and retains literal keys from both eras; it never retargets an old Epic key to another issue.

Combined mode issues **one unfiltered task request**, hides Product/Tech controls and uses no duplicate empty-lane requests. Current [`fetch_tasks:3417`](../../jira_server.py#L3417) can omit a project clause for an empty lane; two such requests would double totals. A paired 8-SP fixture must count one Epic once, produce an Initiative sum of 8 and preserve that surface's existing Ad Hoc/exclusion treatment. Source evidence: [`capacityClassification.mjs:20–39`](../../frontend/src/capacityClassification.mjs#L20), [`normalize_projects:96–119`](../../backend/services/eng_board.py#L96), and current selection/capacity consumers listed in the execution plan. Future Component/Label classification is undefined.

Project Track remains a mapped-parent field: old Epic becomes Initiative, with inheritance to Epic only where the current Story view inherited it. Writes target the actual Initiative key; [`jira_issue_project_track.py:119`](../../backend/services/jira_issue_project_track.py#L119) still rejects non-Epic types and therefore needs an explicit implementation change. Delivery owner, Components and global capacity unit comparability follow the accepted G9 planning decisions below; they are not new required-field gates.

## G1: every current alert category has an explicit disposition

The current rendered registry has ten categories in [`EngAlertsPanel.jsx:4–14`](../../frontend/src/eng/EngAlertsPanel.jsx#L4). [Alerts:48–151](../features/alerts.md#L48) additionally documents Missing Story Points/Missing Epic within Missing Info, the oversized notice and precedence. Initiative has no Sprint requirement and its owning Team is optional, so a blanket parent-field substitution is invalid. Only Stories Required has the confirmed direct Team-label transition. **These new-era dispositions are the accepted planning basis; Legacy behavior stays unchanged.**

| Current category / evidence | Accepted new-era rule | Why / retained limits |
| --- | --- | --- |
| Missing Info: missing Story Points, Epic or Team; [`useEngAlerts:30–91`](../../frontend/src/eng/useEngAlerts.js#L30) | Apply to Epic Story Points/Initiative/Team, preserving existing selected-Sprint, dismissal and status exclusions. | Do not label an optional Initiative Team as missing. Null display does not satisfy estimation. |
| Blocked; [`useEngAlerts:22–28`](../../frontend/src/eng/useEngAlerts.js#L22) | Show blocked Epics under existing visible-row/filter rules. | Preserve normalized blocked matching and exclusions. |
| Postponed Work; [`useEngAlerts:230–236`](../../frontend/src/eng/useEngAlerts.js#L230), [`312–321`](../../frontend/src/eng/useEngAlerts.js#L312) | Show Postponed Epics and rederive future-only Initiative routing from complete Epic children. | Do not read an Initiative Sprint to determine a quarter. Preserve routing/dismissal precedence. |
| Backlog; [`useEngAlerts:159–178`](../../frontend/src/eng/useEngAlerts.js#L159), [`filterExplicitBacklogEpics:93–102`](../../frontend/src/backlogAlertSprintUtils.mjs#L93) | Retire the standalone Initiative parent-hygiene panel in the new model; unsprinted Epics remain in the existing Backlog view. | An explicitly empty Initiative Sprint is normal, not proof of backlog. |
| Missing Team; [`useEngAlerts:183–190`](../../frontend/src/eng/useEngAlerts.js#L183) | Retire this standalone Initiative check; required Epic Team is covered by Missing Info. | Initiative owning Team is optional. Do not create duplicate or false parent warnings. |
| Missing Labels; [`useEngAlerts:196–205`](../../frontend/src/eng/useEngAlerts.js#L196) | Retire the old parent Sprint-label hygiene panel in the new model. Keep exact Initiative Team-alias discovery for expected Epics. | No source-backed Initiative quarter-label requirement; absence of a match does not prove which Team label was required. |
| Stories Required; [`story_readiness.py:155–189`](../../backend/services/story_readiness.py#L155), [`engWorkHierarchy:49–83`](../../frontend/src/eng/engWorkHierarchy.js#L49) | Rename by actual type: expected Team Epic under a labeled Initiative in the selected active/future Sprint. | Confirmed Team-alias owner decision. Preserve one requirement per Team, actionable-status rules and no requirements from partial/stale snapshots. No daily Story required. |
| Waiting; [`useEngAlerts:323–346`](../../frontend/src/eng/useEngAlerts.js#L323), [`406–419`](../../frontend/src/eng/useEngAlerts.js#L406) | Recompute Initiative waiting state from its Epic children and their selected-quarter association. | Preserve existing parent/child terminal-status and readiness precedence; no mandatory parent Sprint/Team. |
| Empty Epic; [`useEngAlerts:221–229`](../../frontend/src/eng/useEngAlerts.js#L221), [`394–405`](../../frontend/src/eng/useEngAlerts.js#L394) | Show Empty Initiative only from complete Epic-child counts, preserving active/future/readiness precedence. | Never turn an incomplete scan or optional missing parent into “empty”. |
| Ready to close; [`useEngAlerts:238–272`](../../frontend/src/eng/useEngAlerts.js#L238) | Show an eligible Initiative only with associated selected-quarter Epics and an authoritative zero-open-Epic count across all quarters. | A future open Epic prevents closure; missing/incomplete count fails closed. |
| Oversized Department notice; [`alert_epics.py:13–45`](../../backend/services/alert_epics.py#L13), [Alerts:100–108](../features/alerts.md#L100) | Shift bounded label-based discovery to Initiatives and report only the affected category source as unavailable. | Apply `status not in (Done, Killed, Incomplete)` before the 2,000-issue/101-page ceiling; readiness additionally excludes Postponed (`eng_routes.py:391–394`). Respect stricter existing limits. |

For retained panels preserve dismissal, filter/count alignment, own-issue navigation and pin behavior. Resolve precedence explicitly after the retired categories are removed; do not let one partial source suppress complete independent sources. The execution plan owns bounded parent batches/depth and exact paired alert fixtures. None of these choices asserts that v41 requires Initiative Sprint/Team or quarter labels.

## Source provenance and accepted planning decisions

**Source:** *RnD work structure for 2027+*, version 41, version date 2026-10-29; reread 2026-10-30. It specifies Epic Sprint (quarter), one Team and Story Points; Initiative/Objective have no Sprint and may have an optional owning Team. Strategy is optional above Objective. `RnD_allocation_category` precedence is explicit Epic→Initiative→Objective. Delivery owner is described on Objective and Initiative. Components are retained without a prescribed carrier level. The four business areas do not establish four new Jira fields. Initiative Team-alias labels are the previously confirmed **owner decision**, not a rule found in v41.

Allocation is a dedicated new field, not an invented Legacy Components feature. Since [DONE-delivery-allocation-split-and-sprint-scoping.md](DONE-delivery-allocation-split-and-sprint-scoping.md) (2026-11-09) it is the DELIVERY Product/Tech source: each Allocation value is mapped to Product or Tech in Settings (`allocationTypes`). Since [DONE-delivery-initiative-allocation-and-board-sprints.md](DONE-delivery-initiative-allocation-and-board-sprints.md) (2026-11-09) the class is read from the Initiative's own Allocation only (owner decision; the Epic→Initiative→Objective precedence above is the source's statement and is not applied, and Epic and Objective values are ignored), and an unmapped, blank or unreadable value is a third class, No Allocation, shown like No Project Track in the facet, capacity totals, split bar, alerts, readiness rows and Stats; DELIVERY Ad Hoc work follows its Initiative's class. The Epic Sprint/Team/Story Points metadata check is a non-blocking pre-live checklist item, not a development or feature-flag activation gate; synthetic/existing Epic fixtures suffice for development. If Jira rejects that placement, revise Task 3's catalog discovery/quarter mapping before live use; do not silently fall back to daily Stories.

| Accepted decision | Planning behavior following the owner’s “proceed” |
| --- | --- |
| D2 Scenario | Disable Scenario for a new-model quarter and return `409 scenario_not_supported` from its source read before running old assumptions. Leave Legacy Scenario history, presence/locks and existing blocked writeback guards unchanged; do not add stamps or source/version migration. Direct new-era draft/legacy-override entry points must fail closed rather than fabricate support. |
| G1 alert dispositions | Implement the accepted category dispositions above; the confirmed Stories Required shift stays fixed. Retired panels do not remove Epic Backlog visibility or required Epic Team/points checks. |
| G9 Strategy | Optional display-only context, no new totals, alert ownership or editor. |
| G9 Delivery owner | Edit the Initiative's own field; show Objective context separately. No inherited write target or assumed Epic field. |
| G9 Components | Use Epic leaf data. The owner confirmed that Component Board shows only matching Epics under their Initiatives: A-only excludes B siblings from display/counts/expansion, A+B includes both without duplicating the parent. No Initiative carrier requirement. |
| Last N source (owner-confirmed after validation) | Only the configuration selected by dashboard quarter. Quarter chooses source/model, not a date filter; retain current rank, window, N choices and limits. Other-configuration setup failure does not block it. |
| G9 point/capacity comparability | Reuse current numeric point/capacity units and formulas, with no conversion; the global workspace capacity source is intended for new Epic points without asserting empirical estimate equivalence. |
| G9 rename/revision | A rename increments that entry revision and stales its in-flight writes, preserving one simple identity rule. |
| G9 Keep mine | A currently valid full bundle wins on explicit retry against the returned workspace revision; disclose overwrite of concurrent bundle edits. Keep mine cannot restore a compatibility mode another editor retired: return a slot-specific validation error, preserve drafts and require explicit Jira mapping repair or Reload. No silent per-entry merge or force-write. Evidence: [`groupsConfigConflict:71–76`](../../frontend/src/settings/groupsConfigConflict.js#L71), [`workspaceConfigConflict:1–4`](../../frontend/src/settings/workspaceConfigConflict.js#L1). |
| G9 non-editors | Keep Admin hidden as today; provide view-level setup/contact guidance without an inspection-only Admin redesign. |
| G9 omitted project type | Preserve Legacy's current default; normalize an omitted new type to `other` rather than rejecting the omission. The combined classification itself is already fixed, never Product. |
| G9 metadata response format and deferred Scenario routes | Use the allowlisted type/Test shapes in the implementation plan; redaction of raw upstream/identity/exception content is mandatory. Preserve Legacy presence/locks/writeback-preview/blocked behavior; no new-era execution through those routes until the separate Scenario work is approved. |

## Round-2 gap status and evidence

D1–D9 each have a separate status/evidence row in the owner-decision table above; that table is part of this round-2 disposition record. The G/U rows below record the remaining contract and work, not production closure. Source line references above were checked in the current checkout; fixture results must be rerun after the requested specimens. D2/G1/G9 defaults are now the accepted planning basis; runtime verification remains future work.

| Gap | Contract/status in this revision | Remaining proof |
| --- | --- | --- |
| G1 | Complete category table replaces the blanket alert shift; only Team-label/Epic requirement has its confirmed direct counterpart. | Paired source/precedence fixtures; decisions accepted for planning. |
| G2 | Legacy filter compatibility, exact/null capture and parent-link rules are explicit; `Epic Link` is used only for Story→Epic, system parent for Epic→Initiative. | Per-consumer unrestricted/multiple/single tests and literal JQL audit. |
| G3 | Server flag off by default; bundle inert until all readers are quarter-aware. One `409 configuration_required` rule and old-writer `configuration_bundle_required`. | Flag-off seeded-bundle test, no-quarter reads and empty bypass allowlist. |
| G4 | Virtual Legacy read and server capture plus explicit edit/clear intent prevent empty echoed defaults from erasing configuration. First-run gates must be adapted before promotion is enabled. | First-save/clear/echo and pre/post-promotion first-run tests. |
| G5 | Every Sprint reader uses an explicit accepted quarter or server Sprint lookup; bootstrap is metadata-only. Department parent-key search admits Initiative. | Execution plan's route inventory, unknown/stale source cases and each safe error body. |
| G6 | Shifted discovery excludes terminal history before ceilings and preserves independent-source incompleteness. | Bounded labels/ancestor pages, depth, deadline and no false empty/ready-to-close assertions. |
| G7 | Read-only DB rollback preflight checks the actual workspace payload; no exported/sanitized-file proxy for runtime state. Older binaries require separately verified restoration. | DB preflight rejection/restoration proof and release instructions. |
| G8 | The first execution artifact is a generated source-site→entity table for literal Epic/Story/Team/level assumptions and their callers, in the existing execution contract. | Current reader/JQL/cache map, worker/measurement/runtime/catalog/frontend bootstrap paths and source guard; not another implementation plan. |
| G9 | Explicit smallest defaults above; no invented fields, formulas, UI lifecycle or hidden ownership change. | Implementation and tests of the accepted choices. |
| U1/U2/U4/U5/U6 | Synthetic unresolved/loading/error, captured single/multiple/unrestricted filter confirmation, blank DELIVERY, named feedback and picker specimens now exist. | `quarterly-work-structure-fields.jsx:54–80,126–261`; Chromium cases in `work_structure_settings_mockup.spec.js:300–416`. Production behavior remains planned. |
| U3 | Per-view setup copy and permission behavior are explicit; no automatic navigation. | Mounted ENG/Planning/Board/Statistics/EPM guidance cases at implementation. |
| U7/U8/U9 | Fixture scroll/touch/Department-row specimens pass; actual shared CSS repair remains Task 2. | `work_structure_settings_mockup.spec.js:418–466`; configuration-list registry in `docs/design-system.md`. Five refreshed captures inspected below. |
| U10 | Three pinned default-markup guards pass; production destructuring/158-count ledger correction remains Task 2 under the no-app-code restriction. | `tests/test_jira_field_settings_default_markup.js:9–49`; source, scope and mapping outputs pinned at `2ae8e47b`. |

## Delivery and verification boundary

This revision changes only design, execution-contract text, synthetic specimens and guards. No app implementation, production code repair, database migration, Jira change, commit or publication is authorized. The parent records actual pinned Node 20 build, fixture Chromium, picker-helper, documentation/structure and new guard outcomes after the final files settle, with five fresh inspected captures. Earlier counts are historical and do not prove these round-2 corrections.

Do not claim live Jira, PostgreSQL, concurrent migration, full application quarter switching or production UI verification from a fixture. Source metadata/access, selected source data and deployment readiness remain unknown. The existing Home read contract and write-only GATE-05 remain unchanged; no Home auth/mutation work is added. Analytics for the synthetic artifact remains none; production instrumentation is part of the existing execution plan.

## Round-2 verification evidence

All final parent commands used Node **20.20.0**; Python checks used the existing project environment, **3.14.7**. Commands ran from the requested migration worktree. No application source changed.

| Actual command | Result |
| --- | --- |
| `npm run build` | Passed; generated output stays ignored. |
| `npx playwright test tests/ui/work_structure_settings_mockup.spec.js --browser=chromium --workers=1` | 30 passed in the final Node 20.20.0 run. Synthetic fixture only. |
| `node --test tests/test_jira_field_pickers.js tests/test_jira_field_settings_default_markup.js` | 22 passed: 19 existing picker checks and 3 new SSR guards. |
| `python3 -m unittest tests.test_agents_md_learnings tests.test_codebase_structure_budgets` | 21 passed with worktree write permission. An earlier subagent sandboxed attempt had seven fixture-write permission errors; it is not counted as a runtime regression or a passing run. |
| Changed/new Markdown links, JSON examples, ontology Coverage line, application-source scope and `git diff --check` | Passed. Whole-file link scan also found two unchanged references outside this revision: the ontology's `epm_home_token_fixture.js` link and the index's `PREFIX-name.md` template example; neither was introduced or repaired here. |

The five PNGs were retaken with animations/transitions disabled and fonts settled, then inspected individually. Compared with the earlier captures, the configuration list uses Department row markup, ranges say quarter, the Scope chip says synthetic `PLAN` while the configuration stays DELIVERY, and mobile Save/Cancel remain visible. Mapping has separate top-preview and lower-field captures; the lower capture is intentionally scrolled.

| Capture | Refreshed artifact |
| --- | --- |
| Scope | [Scope](../../assets/mockups/work-structure-settings-scope.png) |
| Source | [Source](../../assets/mockups/work-structure-settings-source.png) |
| Field mapping, lower fields | [Field mapping](../../assets/mockups/work-structure-settings-mapping.png) |
| Initiative/Epic preview | [Mapping preview](../../assets/mockups/work-structure-settings-mapping-preview.png) |
| Mobile Source | [Mobile](../../assets/mockups/work-structure-settings-mobile.png) |

Addressable synthetic specimens use `?configuration=delivery&section=mapping&admin=project&specimen=unresolved-type`, `type-loading`, `type-error`, `duplicate-types`, or `blank-delivery`; captured-filter specimens use configuration `legacy` and `captured-single`, `captured-multi` or `captured-unrestricted`. These states do not validate Jira, database promotion, concurrency or migration. Actual shared production CSS, quarter-aware readers, the review migration and renderer/ledger repair remain implementation work.

## Implementation-plan handoff (2026-10-30)

The owner’s “proceed” after the round-2 defaults authorizes this planning handoff. The existing [EXEC file](DONE-quarterly-work-structure-migration.md#execution-sequence-and-checkpoints) now has a dependency/checkpoint table, Tasks 0–6 with explicit steps and commands, and mounted acceptance journeys. No new plan file, application code, mockup change, migration, commit or publication was created by this handoff.

Source audit added concrete implementation steps for current adoption tools (`scripts/adopt_legacy_sprint_reviews.py:154–173,269–286`), Legacy Scenario reload (`backend/routes/scenario_draft_routes.py:133–146`), Board-null Team publication (`backend/services/workspace_catalog_cache.py:328–339`), actual mapping-picker states (`frontend/src/settings/MappingPickerRow.jsx:29–55`) and every moved dirty/validation flag (`frontend/src/settings/useSharedConfigSave.js:205–266`). These are planned changes, not completed fixes.

Release behavior is explicit for unpromoted/promoted × flag off/on. Stored `promotionRevision` is internal migration metadata, not a Settings lifecycle: before promotion flag-off preserves the old editor, after promotion flag-off yields unavailable guidance and no fallback. Metadata/editor reads inspect stored entries by configuration id without authorizing quarter-less work. No-quarter bootstrap stays compact; every work request needs admitted quarter/source context. The separately owned JSON/Basic extraction remains an external release prerequisite, while synthetic development proceeds behind the disabled flag. No Home auth/mutation gate is added or cleared.

Planning-handoff verification: 21 documentation/structure tests passed; plan JSON/fences/local links and existing Modify paths were checked. Hash comparisons confirmed the prior mockup, five captures, UI/SSR tests, AGENTS and design-system map were preserved; application sources and ontology Coverage stayed unchanged. Two independent read-only reviews found no blocking/P1 plan gaps after the flag/capture/adoption/Scenario/publication seams were specified. The historical migration-helper replay safeguard is now an explicit Task 5C acceptance case. No implementation or database evidence is claimed by these documentation checks.

## Seven validation findings — plan corrections

This revision follows the three-subagent validation. All seven findings now have explicit implementation contracts and future acceptance cases; no application fixes or live/DB results are claimed. The owner separately confirmed **selected configuration** for Last N and **only matching Epics** for Component Board.

| Finding | Contract correction | Required implementation evidence |
| --- | --- | --- |
| 1 — Legacy parent/ancestor clear | Durable legacyHierarchyModes distinguishes compatibility from mapped-null per slot. First-save commands derive mode and later full-bundle saves retain it. | Captured null ids → clear → Save → reload → unrelated Save → read. Required parent stays incomplete; optional ancestor stays off. A stale Keep mine after another editor retires compatibility must preserve drafts and require explicit repair/Reload, including a first-promotion race. |
| 2 — Settings metadata readers | Components/statuses have explicit selectors/errors/cache/file maps. Stored configuration metadata needs no physical Sprint; project status schemes use mapped parent and need no Board on the promoted path. | Board-null DELIVERY; same Board/projects with changed type; two-era search/cache switch and late reply rejection; no unscoped getter. |
| 3 — Unavailable-quarter identity | Private quarter intent survives nullable physical admission and remains visible/selectable without fabricated Jira ids. | Restore 2027Q1 with only Legacy 2026Q4, remove source/edit range, preserve notice, then admit a real id for unchanged quarter. |
| 4 — Last N | Owner chose selected configuration only, with context-only quarter/id/revision request, same-config cache reuse and existing ranking/window/N limits. | Boundary switch; selected blank DELIVERY; unaffected selected Legacy; no cross-era merge/date predicate or physical-Sprint requirement. |
| 5 — Component Board | Owner chose matching Epic leaves only. Hydrate/group their Initiatives with bounded/progressive source semantics; parent Components do not select membership. | Parent without Components and A=8 SP/B=5 SP: A-only 8 SP, A+B 13 SP; expansion/resume cannot pull B for A-only. |
| 6 — Capture | Pure projection from the same DB-only snapshot plus allowed defaults; ambient getter/request-cache data cannot enter capture. | Patch real JSON loader and ambient getters to fail; virtual GET/first Save still work with no DB row. |
| 7 — Negative guard | Allow _fallback_snapshot with fallback_loader=None to return empty. Patch the actual JSON loader, not the harmless helper branch. | Empty DB succeeds with zero JSON calls; a forbidden loader call fails the negative test. |

Metadata responses retain existing Component/status row fields plus configuration identity. Promoted callers supply configuration id/revision; missing context409, unknown id400, mismatched revision/quarter409 and missing relevant mapping/projects409. Board-null statuses read configured project schemes. Modify scope includes GroupBoardSettings.jsx, boardStatusCatalog.js, boardConfigApi.js, jiraCatalogApi.js and useTeamGroupSettings.js. Current source seams are settings_routes.py:1121,1465–1467,1532; boardStatusCatalog.js:17–24; MappingPickerRow.jsx:35.

The earlier planning-handoff claim of no blocking/P1 gaps is superseded by the subsequent validation and this correction record. New checks concern document consistency; runtime implementation and its tests remain future work.

Plan-fix verification (2026-10-30): `python3 -m unittest tests.test_agents_md_learnings tests.test_codebase_structure_budgets` passed21 tests. JSON/mode examples, fences, local plan links, existing/Create file maps, new ontology links and `git diff --check` passed; ontology Coverage stayed unchanged. Hash checks preserved the12 prior files outside these three document edits, including mockups/captures/tests/learnings/design-system work. The three focused read-only closure reviews found the seven contracts addressed; the related Keep mine retirement race was specified and rechecked. No application, browser, live Jira, PostgreSQL or migration test was run for these documentation fixes. HEAD remains2ae8e47b; no commit or publication.
