# Quarterly project configurations design

> **Status:** Proposed feature design, 2026-10-30. The document and mockup are design artifacts; application implementation is not complete.

This feature lets the dashboard keep its current project structure through `2026Q4` and use the new structure from `2027Q1`. A dashboard Sprint means one quarter. The viewed quarter selects the configuration automatically; choosing an item in Settings only chooses which configuration to edit.

The migration uses two supported models. It does not require a new administrative lifecycle, a generic hierarchy designer or a Jira data migration.

## Settings layout

Admin has this exact two-level hierarchy:

```text
Admin
├─ Project config
│  ├─ Left: Legacy / DELIVERY configuration list
│  └─ Right: selected configuration editor
│     ├─ Selected name and range summary
│     └─ Scope / Source / Field mapping nested tabs
├─ Capacity
├─ Priority weights
├─ Access
└─ Performance
```

Only **Project config** shows the configuration list, selected-name/range header and nested tabs. Capacity, Priority weights, Access and Performance display their existing workspace panels without that configuration chrome. Returning to Project config restores its selected configuration, nested tab and drafts.

The left list follows the Department groups pattern. Legacy is initially selected; rename it inline in its selected left row. Do not duplicate its name input on the right. On compact screens, the list becomes the existing-style Configurations drawer.

The selected right editor contains:

- **Scope:** start/end quarter and selected Jira project chips; existing Add, remove and search behavior. Legacy retains Product/Tech project sections; DELIVERY shows one planning project without inventing a classification.
- **Source:** the existing Jira source Board editor and its current selected/search behavior.
- **Field mapping:** the existing issue-type/field mapping controls and preview, including technical field IDs and established pickers. The selected configuration owns these values. The fixture uses the existing Issue type picker to switch between Story / Legacy and Epic / new structure; it adds no separate Structure control. The implementation maps these choices to the two supported models and their hierarchy roles, with no generic hierarchy designer.

There is one global footer Save and the established Cancel behavior. No additional overview cards, configuration bar, per-tab Save, activation state or scheduling step is introduced.

## Configuration ownership and time ranges

| Configuration | Range | Initial model |
| --- | --- | --- |
| Legacy | Open start through `2026Q4`, inclusive | Current quarterly planning structure |
| DELIVERY | `2027Q1` through open end | Quarterly team Epics under deliverables |

Ranges use `YYYYQn`; a blank start/end is open-ended. Validate ordering, overlaps, gaps and the agreed Q4/Q1 boundary. The two initial entries have stable opaque ids. Their names and supported model choices are edited normally; an id must never imply a model.

Each entry owns its range, projects, Jira source, hierarchy roles and field mappings. The workspace stores the complete project-configuration bundle with one optimistic revision. **Capacity remains global:** its current storage, routes, numeric-field verification and controls are unchanged, and no capacity value is copied into either entry. Priority weights, Access and Performance also remain workspace-level.

Department groups retain their collaborative ownership; group preferences remain private. EPM goal scope, Home project-label mappings and legacy issue-type presets remain in each user's private saved view. Project configuration never absorbs those values. See the [configuration ownership contract](../../backend/security/CONFIGURATION_OWNERSHIP.md).

## Editing and saving

Switching left configuration or nested tab preserves both configurations' independent drafts. A structure/model correction uses the same editor and Save as any mapping correction. A concise in-form warning explains that edits affect live views throughout that configuration's quarter range; no separate correction wizard is needed.

Save can persist incomplete field mappings if their shapes and ranges are valid. It does not claim that Jira is ready. When a required source or mapping is unusable, selecting the affected dashboard quarter shows clear setup guidance rather than silently substituting Legacy. Optional missing fields affect only their dependent control or report.

The footer saves all dirty editable owners. Project ranges/scope/source/roles/fields use one atomic bundle request; a dirty global Capacity mapping still uses its existing endpoint, with the shared revision updated between requests. Other ownership domains keep their endpoints. If a later save fails, show exactly which sections committed and retain the unsuccessful drafts; never describe separate requests as one database transaction.

A stale revision uses the existing conflict surface and preserves local edits. Explicit Reload follows existing discard confirmation. Clean state can adopt a remote baseline; dirty state cannot silently overwrite another editor's changes. Read-only users can inspect saved configuration but cannot edit without the server's explicit permission grant.

**Test configuration** is optional and tests the saved selected configuration using the existing interaction. It reports a simple success/error/unknown result from read-only metadata/access checks. Unsaved edits are not silently tested or saved, and a failed/unavailable test does not prevent an otherwise valid incomplete Save.

## New work meaning

The current quarterly commitment represented by a Story becomes an **Epic / quarterly team KR** in the new model. Its parent Initiative represents a deliverable; Objective provides project context and Strategy is an optional program. Preserve actual Jira issue types, ids and keys in display, exports, dependencies and edits.

Daily team Stories can live in team projects. They are optional operational detail, not a prerequisite for quarterly KR visibility or planning. Discover new work from the quarterly KR's Sprint/Team, then fetch parents as context; do not require quarter or Team on every ancestor.

Allocation Category is separate from Components and from Product/Tech classification. Resolve a readable explicit KR value before Initiative, then Objective. An unreadable intermediate ancestor may contain an override: report unavailable instead of claiming a higher ancestor's value is authoritative. Missing/unreadable parents must not remove a readable KR.

Count quarterly effort once at the KR contract; do not add its daily Story estimates or parent/child work logs again. Legacy Story-readiness alerts do not automatically become new KR health rules. Until a genuine Product/Tech source is agreed, new work is unified/unclassified rather than defaulting to Product.

Business decisions still open:

- The exact Jira representation and values for Work Area: Project, Continuous Improvement, Interrupt and Org Invest.
- Project Track and owner field contexts/editability; proposed default is track on the KR, Assignee as dev owner and independently mapped Delivery owner.
- A genuine Product/Tech source, if that split is still needed for the new model.
- The authoritative KR estimate, remaining/completed effort, capacity unit and dependency semantics.

Keep dependent editors/reports unavailable or explicitly missing until these decisions are confirmed. Independent development and normal configuration editing can proceed with synthetic data.

## Alternatives considered

| Approach | Tradeoff and decision |
| --- | --- |
| One quarter-ranged configuration bundle | Chosen. Projects, source and structure move together, while the existing Settings editor remains familiar. Legacy corrections use the same flow. |
| Separate start/end quarters on Scope and every mapping | Smaller storage changes, but independent ranges can select projects from one era and fields from another. It also repeats range editing across screens. |
| Fixed Q1 switch with two hard-coded models | Viable for a one-off migration, but corrections would require releases or another special editor. Retain two supported models behind one shared resolver and ordinary configuration editing instead. |

## Technical approach

The implementation contract is the [quarterly migration execution plan](EXEC-quarterly-work-structure-migration.md); it owns the detailed file inventory, route shapes, tests and compatibility cases. This design defines the interaction and product behavior, without duplicating that checklist.

`workConfigurations` in the existing workspace Admin payload is the structural source of truth. First save captures the current effective Legacy settings server-side, applies explicit validated edits under the revision fence and removes only duplicated project/source/field/type keys. Global capacity and its verification metadata stay untouched. Existing readers delegate to a captured configuration; old partial structural writers cannot split projects from mappings. No new database migration is needed for this bundle.

`resolve_work_configuration(snapshot, quarter, configuration_id)` returns one immutable context with the configuration id/revision/model, quarter, digest and resolved scope/roles/fields. Carry it and the existing auth context into workers and all dependent queries, caches, streams and writes. A delayed response or edit from another configuration must fail its identity check. All work uses the configuration associated with the accepted dashboard quarter.

Retain actual Board/Sprint ids in catalogs; identical quarter names across sources do not make their ids interchangeable. Preserve current Legacy canonical duplicate selection. Requests spanning the boundary resolve each quarter separately and separate metrics whose Story/Epic units are not comparable.

A two-model planning adapter preserves Legacy behavior and supplies new KR-centered data. Existing review values retain immutable issue ids and native Epic/Story cell kinds; no automatic Story-to-Epic value transfer. Scenario sources/versions keep their original configuration interpretation. EPM preserves private Home scope and exact labels; workspace roles visibly control new-quarter Jira rollups while private legacy type presets remain intact and usable for Legacy.

Use current workspace/auth/CSRF guards and own-issue edits. JSON compare/save needs a stable process/cross-process lock around revision check and replacement; DB writes use the current workspace fence. Forward rollback preserves stored data; an older binary requires explicit verified restoration of promoted structural keys. This is not permission to rewrite Jira history.

## Mockup construction and review

The [interactive HTML specimen](../../assets/mockups/quarterly-work-structure-settings.html) uses synthetic configuration data and repository CSS. Source and Field mapping mount the unchanged production [`JiraFieldSettings.jsx`](../../frontend/src/settings/JiraFieldSettings.jsx), directly imported by [`quarterly-work-structure-fields.jsx`](../../assets/mockups/quarterly-work-structure-fields.jsx). Existing Story/Epic labels and preview copy are intentionally retained in the specimen; the application implementation must bind role-aware copy and additional role mappings to the selected model. The fixture reuses `makeFieldSearchResults` and `makeFieldKeyDown` from the existing picker helpers; it must not approximate those forms with a second implementation.

Build the fixture controller with [`build_work_structure_mockup.cjs`](../../scripts/build_work_structure_mockup.cjs):

```bash
node scripts/build_work_structure_mockup.cjs --serve
```

The script bundles only the fixture into ignored `tmp/quarterly-work-structure-fields.js` and records its module inputs there. It does not modify application components or publish generated output. Open `http://localhost:5062/assets/mockups/quarterly-work-structure-settings.html`; use the pinned Node 20 toolchain and run `npm ci` first in a fresh checkout. The local preview server serves only the fixture, generated controller and existing CSS. Use `--port=5063` if 5062 is already occupied.

Preserve existing native buttons, labels, focus and picker behavior. Use the established selected/disabled states, touch-accessible actions and polite result feedback. At compact widths, the drawer must not cover the active editor after selection; tabs/forms/footer remain usable without clipped controls. This is reuse of the app's existing behavior, not a claim of a completed accessibility audit.

Acceptance for implementation:

- Exact upper Admin tabs and nested right-editor tabs; global panels hide configuration chrome and returning restores drafts/selection.
- Legacy three-project and DELIVERY single-project scope, unchanged real Source/Mapping controls, mobile drawer and one footer Save.
- Q4/Q1 automatic selection, inclusive range validation, incomplete Save and no silent fallback; stale requests/writes rejected.
- Atomic structural save plus accurate partial-save/conflict handling; unchanged global capacity and private/group ownership.
- Actual Epic KRs work without daily Stories; totals/provenance, review/Scenario preservation and EPM precedence follow the execution plan.

## Outcome and limits

This deliverable is a design document and interactive fixture. The application migration, backend/storage routes and live Jira checks are unimplemented. The mockup changes only local synthetic state; it sends no app API request, saves no production configuration and emits no analytics. Its analytics impact is trigger/event_type/event_name none, feature_name settings, typed params none; production instrumentation is specified in the execution plan.

Verified on 2026-10-30 in the dedicated `docs/quarter-sprint-terminology` worktree:

| Command/check | Result |
| --- | --- |
| `npm run build` with Node 20 | Passed |
| `npx playwright test tests/ui/work_structure_settings_mockup.spec.js --browser=chromium --workers=1` | 5 passed: navigation/drafts, real Source pickers, independent mappings/preview, mobile drawer, quarter boundary/scope |
| Project Python `unittest` modules `tests.test_agents_md_learnings` and `tests.test_codebase_structure_budgets` | 21 passed |
| `node --test tests/test_jira_field_pickers.js` | 19 passed |
| Visual inspection | Desktop Scope, Source, Field mapping and its scrolled preview; mobile Source and reachable footer |

Screenshots: [Scope](../../assets/mockups/work-structure-settings-scope.png), [Source](../../assets/mockups/work-structure-settings-source.png), [Field mapping](../../assets/mockups/work-structure-settings-mapping.png), [scrolled preview](../../assets/mockups/work-structure-settings-mapping-preview.png), [mobile](../../assets/mockups/work-structure-settings-mobile.png). The revised screens place configuration navigation inside Project config and use the actual Source/Mapping forms; earlier A/B/C concepts are superseded.

These checks validate the synthetic fixture and unchanged picker helpers. Live field metadata, access, business semantics and performance remain unverified; the application migration and its full acceptance suite have not run. GATE-05 remains unchanged and write-only, next review 2026-11-02; this feature adds no Home auth migration or Home write capability.
