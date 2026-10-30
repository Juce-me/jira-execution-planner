# Quarterly project configurations design

> **Status:** Proposed feature design, revised 2026-10-30. The Settings specimen is a local fixture; application migration, persistence and live Jira acceptance remain planned.

A dashboard Sprint means one quarter (`YYYYQn`). The initial configurations are Legacy through `2026Q4` and DELIVERY from `2027Q1`. These are editable initial ranges, not a hard-coded cutover. The viewed quarter selects the saved configuration automatically; selecting a left-hand item in Settings only chooses which configuration to edit.

## Settings layout

Keep the approved two-level Admin navigation:

```text
Admin
├─ Project config
│  ├─ Left: Legacy / DELIVERY configuration list
│  └─ Right: selected name and range summary
│     └─ Scope / Source / Field mapping nested tabs
├─ Capacity
├─ Priority weights
├─ Access
└─ Performance
```

Only Project config shows the Department-style list and selected editor. Legacy is initially selected, and its name is edited inline in the selected left row, without a duplicate name input on the right. At compact widths, the list uses the existing Configurations drawer. Global panels hide configuration chrome; returning restores the selected configuration, nested tab and drafts.

- **Scope:** editable start/end quarters and Jira project chips, with existing Add/remove/search behavior. Render sections from the stored project classifications, so changing a Jira issue-type mapping cannot hide a selected project. Legacy retains its current Product/Tech split. DELIVERY initially selects one Jira project and shows combined totals.
- **Source:** reuse the current Jira source Board and Sprint-field controls, selected state, technical IDs and pickers.
- **Field mapping:** reuse and extend the existing renderer for editable hierarchy rows, Project Track and `RnD_allocation_category`, alongside the existing fields and preview. Values and preview labels use actual Jira issue-type and field names. No separate Structure selector is required.

One global footer Save persists all dirty editable owners. Cancel uses the established dirty-discard confirmation and restores the complete accepted baseline only after confirmation. Switching configuration or nested tab preserves local changes; a field edit emits changed keys rather than overwriting a renamed configuration from an older whole-object snapshot. Show a concise warning that edits affect live views throughout the selected range. Test/save feedback belongs to the configuration and revision it describes and clears when that context changes.

## Hierarchy mappings and names

Each configuration has a stable opaque id and an explicit internal model token, `legacy` or `rnd_2027`. The token selects one of two adapters and supplies initial defaults; it is neither a displayed Jira name nor a value inferred from the literal text `Epic`. A renamed Jira type or a mapping edit cannot switch the model, Scope sections or classification.

Use four nullable, single-valued type-id settings. Resolve values through Jira metadata containing id, name and hierarchy level; display Jira names rather than process-specific aliases. Empty mappings may save, but a required missing mapping prevents that configuration's affected reads with clear setup guidance.

| Stored setting | Legacy initial Jira name | DELIVERY initial Jira name |
| --- | --- | --- |
| `planningIssueTypeId` | Story | Epic |
| `parentIssueTypeId` | Epic | Initiative |
| `ancestorIssueTypeId` | Initiative | Objective |
| `optionalAncestorIssueTypeId` | Unmapped | Strategy, optional |

An administrator can change each mapped type through the same selected-chip/remove/search behavior. The preview must show those resolved Jira names and actual fields; a missing mapping is explicit, rather than a Story preview left behind for an Epic configuration. Jira type ids remain identities when names change. Initial Legacy capture also preserves an existing multiple-name or unrestricted issue-type filter; show that exact filter and retire it only when the administrator explicitly replaces the planning-type mapping, as specified by `legacyIssueTypeNames` in the execution contract. Other edits must not silently narrow Legacy data. The implementation plan defines metadata validation and the behavior of unsupported hierarchy relationships; the fixture does not attest live Jira metadata.

Project Track remains a configurable Jira field on the mapped parent: Legacy Epic becomes new Initiative. It is inherited by the child only where the current view already inherits it; edits always target that parent’s own Jira key. `RnD_allocation_category` is a separate configurable field; neither chooses the hierarchy model or silently classifies work as Product or Tech. There is no current application allocation contract to capture as a Legacy Components allocation rule, and this feature adds no invented extra classification field.

## Ranges, ownership and saving

Ranges use `YYYYQn`, inclusive ends and optional open bounds. Validate syntax, start/end ordering and nonoverlapping complete coverage across the two configurations. Adjacent valid ranges can move away from the initial Q4/Q1 boundary through normal Save; neither names nor ids freeze that boundary. Retain each configuration's stable id when its name or range is edited.

Each entry owns its range, project scope, source Board, hierarchy mappings and Jira field mappings. Store the complete project-configuration bundle under one workspace optimistic revision. **Capacity stays global:** keep its existing storage, routes, numeric-field proof and controls; do not copy it into entries. Priority weights, Access and Performance remain global. Department groups remain collaborative, group preferences remain private, and EPM Home scope/project-label mappings/private legacy type settings remain user-owned. See the [ownership contract](../../backend/security/CONFIGURATION_OWNERSHIP.md).

The first bundle Save captures the current effective Legacy settings server-side, including applicable existing environment defaults, then applies explicit validated Legacy draft edits in that same revision-checked transaction. It must not discard an initial edit or require another Save. Remove only the duplicated project/source/type/field keys; global Capacity and its verification stay untouched. Capture preserves current behavior but does not create a historical Jira snapshot.

Save accepts incomplete field mappings when their shape and ranges are valid. Save does not prove Jira access. Selecting a quarter whose required source/mapping is unusable shows concise setup guidance with no fallback to another entry or environment value. An optional missing field affects only its dependent control/report. The execution plan defines the exact precedence, reader delegation, catalog authority and write-stamp contracts.

A dirty global Capacity mapping still uses its existing endpoint; chain the returned shared revision between it and the structural bundle request. Other owners keep their endpoints. Report exactly which sections committed if a later request fails, and retain the unsuccessful drafts. A stale revision uses the existing conflict surface; explicit Reload follows existing discard confirmation. Read-only users inspect saved values without editable controls unless the server explicitly grants permission.

Optional Test configuration uses the existing saved-configuration interaction and a simple read-only result. Dirty edits must be saved first; the fixture states that it performs no Jira test. A failed or unavailable test does not block an otherwise valid incomplete Save. The fixture hides project-scoped Test on global Capacity; the existing application Capacity mapping and verification contract stays unchanged.

## Existing behavior, one Jira level higher

Apply the existing calculations and alerts through this mapping, preserving each surface's status, exclusion, grouping and capacity rules:

| Existing entity | Entity in the new structure |
| --- | --- |
| Story | Epic |
| Epic | Initiative |
| Initiative | Objective |

Use the configured Jira ids and display their actual names. An Initiative aggregates its Epics using the existing Epic-from-Story calculation. Story Points come from the mapped Epic field; do not invent a replacement effort field, formula or parent/child time-log summation. The existing daily Stories under those Epics are optional operational detail and do not become a new prerequisite for planning, totals or alerts.

Existing alerts move one level too. A check currently finding a missing or unestimated Story under an Epic becomes the corresponding Epic check under an Initiative, with the same existing calculation/status/exclusion semantics. Do not suppress the existing checks merely to accommodate the migration, or keep requiring daily Stories in the new structure.

Department `teamLabels` retain their current per-Team alias arrays and ownership. In the new structure those aliases match Initiative labels; they establish which Department Teams need corresponding Epics for the selected Sprint. Discover the Initiative context from those labels even when the Initiative has no Sprint/Team value, then evaluate its Team Epics in the selected Sprint. An absent expected Team Epic remains detectable. Matching remains exact per existing alias rules; it is not a replacement Jira project scope or allocation category.

For the new single-project structure, show combined totals using the existing `other` classification where an internal project-type value is needed. Preserve Legacy Product/Tech behavior. A possible future Component/Label classification has no agreed definition and is outside this feature; do not silently map other work to Product.

## Source evidence and limits

[RnD work structure for 2027+](https://criteo.atlassian.net/wiki/spaces/~i.moldovan/pages/5492835223/RnD+work+structure+for+2027), version 41 dated 2026-10-29, was read through the connected source during this review. It specifies Sprint/Team/Story Points on Epic, with Initiative and Objective not assigned a Sprint, and optional Strategy above Objective. This is the proposed business contract, not proof that the live project's field contexts or Board already support it. Verify those identities before live use without turning configuration editing into another lifecycle.

The proposal introduces `RnD_allocation_category`, with an explicit Epic value taking precedence over Initiative, then Objective. Show provenance or missing/unavailable values; an unreadable intermediate ancestor can contain an override and must not be skipped to claim a higher value. This dedicated field does not retroactively establish an allocation feature in the existing app. The source's discussion of company reporting through Components is not an application storage/calculation contract.

Earlier quarters remain live Jira reads using their saved configuration. The app cannot reconstruct issue types, estimates, status, parents or project values changed in Jira, and this feature does not move/retype Jira issues. Changing a saved range/mapping can change that range's live interpretation; the in-form warning must say so.

## Technical approach and preserved work

The [execution plan](EXEC-quarterly-work-structure-migration.md) owns the detailed repository operation, endpoint matrix, environment precedence, catalog/cache inventory and tests. `workConfigurations` becomes the project/source/type/field source of truth through an atomic multi-key operation. Old partial structural setters must delegate or reject after promotion; one section write cannot independently remove the old keys. JSON needs an explicit persisted revision and one process/cross-process lock around every relevant read-modify-write; DB mode uses the existing workspace fence.

A captured configuration contains id/revision/model, viewed quarter, digest and resolved mappings. Carry it and existing auth into queries, workers, catalogs, memos, streams and writes. Resolve physical Board/Sprint identities before selecting a quarter; matching quarter names do not make ids interchangeable. Preserve Legacy canonical duplicates and valid old choices when the new source is unavailable. Requests spanning configuration ranges resolve each period separately. Existing data/issue writes compare their submitted configuration stamp before any Jira mutation.

The two adapters preserve the existing per-surface formulas and shift their entity inputs. Current review storage only accepts native `epic`/`story` kinds, including `String(8)` and database CHECK constraints. Editable Initiative review rows therefore require an explicit forward migration of width/kinds, column/schema/layout rules, authorization and client handling, with rollback and populated-data tests. Existing Story/Epic values remain on their own immutable Jira ids; never rename or transfer them to different issues to simulate the shift. This review-data migration is planned, not delivered by the JSON configuration bundle or fixture.

Scenario sources/versions keep their original configuration interpretation. EPM preserves each user's Home scope and exact labels, uses the configured Objective/Initiative/Epic hierarchy for new-quarter Jira results and retains private legacy type presets for Legacy. Existing auth/CSRF/workspace and own-issue guards remain. Forward rollback preserves saved configuration/review/draft data; running an older binary needs a separately verified restoration path, rather than a claim that old code can reject a new payload itself.

## Alternatives considered

| Approach | Tradeoff and decision |
| --- | --- |
| Two ranged configurations with one selected editor | Chosen. One range selects consistent projects/source/hierarchy/fields; corrections use the same editor and normal Save. |
| Independent ranges on every mapping | Repeats range editing and can combine scope from one period with fields from another. |
| Fixed switch tied to literal Jira names | Cannot support the confirmed editable ranges or renamed/mapped Jira types. |

## Mockup construction and review

The [HTML specimen](../../assets/mockups/quarterly-work-structure-settings.html) uses synthetic state and repository CSS. Its [controller](../../assets/mockups/quarterly-work-structure-fields.jsx) imports the real [JiraFieldSettings renderer](../../frontend/src/settings/JiraFieldSettings.jsx) and existing picker helpers. That renderer now has a narrow optional extension for the editable hierarchy rows, Project Track, `RnD_allocation_category` and accurate hierarchy preview. Existing consumers retain their default behavior. Reuse of a shared renderer is not a claim that this extension or the migration was already present in production.

The fixture imports the real `SettingsModal` for its shell, footer and dirty Cancel confirmation. The list, ranges and memory-only state controller are local fixture code. Scope, Source, Field mapping and the preview use the shared `JiraFieldSettings` renderer, with its optional [MappingPickerRow](../../frontend/src/settings/MappingPickerRow.jsx) extension. Existing production callers retain their default markup; the fixture does not duplicate those forms. Hidden per-configuration panels preserve independent tabs and picker queries while navigating.

```bash
node scripts/build_work_structure_mockup.cjs --serve
```

The script bundles only the fixture into ignored `tmp/` output and serves an allowlist of the specimen, generated controller and existing CSS at `http://localhost:5062/assets/mockups/quarterly-work-structure-settings.html`. Use the pinned Node 20 toolchain and this checkout's dependencies. It changes no app persistence; `--port=5063` selects another unused preview port.

### Review finding dispositions

The external review numbered B1 plus P1-1 through P1-15. These dispositions separate corrected design requirements and fixture verification from production implementation, which remains open. Final fixture results must be recorded from the revised files; earlier passing counts do not prove these corrections.

| Finding | Design/mockup disposition | Application implementation |
| --- | --- | --- |
| B1 | Four editable single-id Jira-name rows, id/name/level metadata and both named fields replace the inadequate single-name picker contract; shared renderer extension required. | Metadata endpoint, validation and persistence planned. |
| P1-1 | A mapping edit cannot infer/change the model or hide Scope projects; historical-impact warning required. | Configuration-aware Scope/classification planned. |
| P1-2 | Resolved Jira hierarchy names and missing mappings drive the shared preview. | Actual hierarchy queries/rendering planned. |
| P1-3 | Generic editable adjacent ranges replace hard-coded Q4/Q1 rejection. | Server range validation planned. |
| P1-4 | Field callbacks emit patches; rename and field edits share one accepted draft. | Production draft integration planned. |
| P1-5 | Atomic multi-key promotion, persisted JSON revision and all-writer locking are required. | Repository/concurrency implementation and race tests planned. |
| P1-6 | Captured configuration is the reader choke point; direct readers/bootstrap must be inventoried and guarded. | Whole-backend reader migration planned. |
| P1-7 | Materialize effective Legacy defaults once; explicit incomplete entries cannot fall back to environment mappings. | Precedence enforcement planned. |
| P1-8 | Per-configuration Board/Sprint identities, completeness and setup errors are explicit. | Catalog route/cache adaptation planned. |
| P1-9 | Configuration identity belongs in field memos and all dependent caches. | Full inventory/invalidation tests planned. |
| P1-10 | Existing write routes carry and compare the configuration stamp with concrete errors. | Route-body compatibility and stale-write tests planned. |
| P1-11 | Source v41 confirms the proposed Epic Sprint/Team/Story Points placement; live contexts remain unverified. | Live metadata/access evidence pending. |
| P1-12 | Actual Story/Epic/Initiative/Objective names and neutral mapping keys replace ambiguous role aliases. | Native Initiative review kind requires a planned migration. |
| P1-13 | No invented Legacy allocation or extra classification field; dedicated new field has source-backed inheritance. | New field reads/provenance planned. |
| P1-14 | Reuse existing `other` and show combined totals; future Component/Label split is undefined. | Remove forced Product fallback in new-configuration calculations. |
| P1-15 | Consistent internal tokens, materialized defaults and Initiative-label-to-Team-Epic scope are specified. | Backend hierarchy/JQL consumers and per-surface alerts shift together. |
| Bundled fixture findings | Require Cancel confirmation, truthful context-bound feedback, long/blank-name handling, generic ranges, preserved drafts/picker state, real Scope behavior and reachable mobile controls; global Capacity has its own context. | Conflicts, partial saves, permissions, auth expiry, review migration, live quarter switching and full runtime verification remain planned. |

The revised fixture checks below exercise the rendered mapping, range, draft, Cancel, feedback and mobile requirements. Backend, storage, migration and live-data claims remain implementation work, as recorded in the right column.

## Outcome and limits

This deliverable is a revised design and local specimen. Application migration, backend storage/routes and live Jira checks remain unimplemented. The fixture changes synthetic state, sends no app API request, saves no production configuration and emits no analytics. Analytics impact for this artifact: trigger/event_type/event_name none, feature_name settings, typed params none; production instrumentation belongs to the execution plan.

Verified on 2026-10-30 with the pinned Node 20 toolchain and the existing project Python environment:

| Check | Actual result |
| --- | --- |
| `npm run build` | Passed after the optional renderer changes. |
| `npx playwright test tests/ui/work_structure_settings_mockup.spec.js --browser=chromium --workers=1` | 12 passed. The final Source wording/mobile capture subset also passed 2 cases. |
| `npx playwright test tests/ui/settings_unified_save.spec.js tests/ui/jira_field_picker_read_race.spec.js --browser=chromium --workers=2` with a synthetic localhost test base | 60 passed, 1 optional DOM capture skipped. Existing Settings save, conflict, auth-recovery and picker behavior is preserved. |
| `node --test tests/test_epm_settings_source_guards.js tests/test_jira_field_pickers.js tests/test_design_system_ratchets.js tests/test_design_system_hover_foundation.js tests/test_design_system_write_contract.js` | 99 passed. |
| Project Python `unittest` modules `tests.test_agents_md_learnings` and `tests.test_codebase_structure_budgets` | 21 passed. |
| Three representative default Source/Mapping/Scope server-rendered fixtures | Byte-identical before/after when optional props are omitted; existing browser journeys provide additional runtime coverage. |
| Artifact checks | JSON examples and local links valid; ontology Coverage unchanged; only the two intended renderer ledger entries changed. |

Updated screenshots: [Scope](../../assets/mockups/work-structure-settings-scope.png), [Source](../../assets/mockups/work-structure-settings-source.png), [Field mapping](../../assets/mockups/work-structure-settings-mapping.png), [scrolled preview](../../assets/mockups/work-structure-settings-mapping-preview.png), [mobile](../../assets/mockups/work-structure-settings-mobile.png). Visual inspection confirms the existing forms are reused, explicit Jira mappings and the Initiative/Epic preview replace the implicit model switch, and the mobile footer/remove controls remain reachable. These replace the earlier review captures.

The full extraction-interface checker exits 1 with 10 ledger discrepancies in unchanged EPM/Department owner entries. It was run with Node 20 on both an isolated source snapshot of `43396243` and the revised worktree: all 10 enforced diagnostics match, and neither changed renderer adds a diagnostic. Those unrelated entries were not restamped. This is a verified baseline failure, not a passing full-check result.

Live field identities/access, configured data and performance remain unverified. Existing [Home public-read design](SUPPORT-home-oauth-public-read-design.md) and [write-only GATE-05](GATE-05-home-write-capability.md) stay authoritative; this feature adds no Home auth migration or Home writes. GATE-05's recorded next review is 2026-11-02 and is unchanged inside its review window.
