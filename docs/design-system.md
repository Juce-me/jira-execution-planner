# Design system and own-issue write contract

Verified on 2026-10-29. This map records Part 1 write boundaries, Part 2 foundation and the locally implemented Part 3 surface migration. The original integrated verification passed; current hover-refinement results and the resolved WebKit search-clear test race are recorded in the [execution plan](plans/EXEC-design-system-part-3.md). The [delivery design](plans/SUPPORT-design-system-hover-contract-design.md) keeps spec #3 scales/shared Button work separate.

Reuse an existing kind, component and class before adding another. One kind should have one look and one hover language. Interactive hover communicates clickability; passive rows and cards should not acquire it. The hover system changes colour and borders without moving or resizing controls. Existing selectors consume foundation tokens; there are no new kind classes, grouped kind lists or cascade layers. Resting fills, dimensions, typography and mutation behavior remain unchanged. Three lifts and all ten transition-all declarations are removed; obsolete surface elevations and movement resets leave the shrink-only baseline as their ownership batch is verified.

## Element map

| Kind | Canonical component or entry point | Existing hooks / variants | Hover kind and write boundary | Deferred target |
| --- | --- | --- | --- | --- |
| Status pill | `ui/StatusPill.jsx`, `issues/StatusTransitionMenu.jsx` | `status-pill`, co-applied `task-status`; passive span / interactive button; compact `epic-status-pill` variant on the Board Epic card's progress row and the EPM project board header (which shows no Jira label; the duplicates callout renders it as `epic-key` text) | Brightness and semantic tints with the shared ring; interactive menu writes its own issue only | Reuse existing StatusPill |
| Priority and Project Track controls | `issues/PriorityTransitionMenu.jsx`, `issues/ProjectTrackTransitionMenu.jsx` | `priority-transition`, `task-priority-icon` (`styles/eng/status-transitions.css`, `styles/eng/issues.css`), `epic-track-indicator` (`styles/eng/epics.css`) | Priority uses its issue; Project Track uses its displayed `epicKey`; never its children | Reuse existing issue controls |
| Person avatar | `ui/PersonAvatar.jsx` (host list `ui/avatarHosts.js`, mirrored by `backend/security/avatar_urls.py`) | Existing slots only: `task-assignee-icon` (14px in Story rows, 20px in the Epic header) and `epm-project-board-owner-avatar`; descendant `img` rule, no new class hook | Passive: no hover, not a click target, writes nothing; a failed or non-allowlisted URL renders the slot's existing glyph or initials | None |
| Pill, chip, badge | Classes in the registry below | Semantic labels, filters, selected chips, remove actions | Passive labels write nothing; remove/select writes only the represented local selection | Ring only for interactive controls |
| Buttons | Existing native buttons; no shared Button | Filled, secondary, transparent, light, pending / disabled | Enabled global foundation uses the 8% own-text-colour overlay and ring; action-specific authority | Button/scales in spec #3 |
| Icon buttons | `ui/IconButton.jsx` | `icon-button--sm`, `icon-button--md` (`styles/shared/controls.css`); loading/variant hooks | Tinted circle for unframed icons; existing visible borders determine framed hover shape; action-specific authority | Reuse existing primitive |
| View and Epic link copy | `shareView/ShareViewButton.jsx` | Existing `header-icon-button`, `secondary compact`, small `IconButton`; `[data-share-view]` placement hooks | Header Copy view link omits focus; Epic title/real Planning Epic summary action passes its own key. Foundation framed hover; reserved 24px Epic slot reveals on header/row hover or focus and remains visible on touch. Clipboard only; no Jira write | Reuse one capture and clipboard lifecycle; success checkmark, compact export feedback only for warnings/manual copy |
| Export feedback and manual copy | `components/JiraExportButton.jsx`, `shareView/ShareViewButton.jsx` | Existing `jira-export-toast` warnings, neutral `jira-export-menu` manual URL, `search-input`, `secondary compact` dismissal | No ordinary-success popup; existing compact control hover and selectable read-only URL, no write | Reuse existing export surfaces; menu body inherits the existing menu-item typography contract from `export.css` |
| Settings section tabs | Existing buttons in `settings/SettingsModal.jsx`, `settings/AdminSettingsTabs.jsx`, `settings/DepartmentsSettingsTab.jsx` and `epm/EpmSettings.jsx` | `group-modal-tab` (`styles/settings/team-groups.css`); active / inactive / disabled | Inactive hover adds a neutral bottom underline, selected tabs keep their accent underline; no shading or boxed hover ring | Preserve section selection and existing focus outlines |
| Segmented control | `ui/SegmentedControl.jsx` | `segmented-control`, `eng-mode-control` (`styles/shared/controls.css`, `styles/eng/controls.css`) | Ordinary overlay/ring; selected fill and ink plus ring only; local view state | Preserve fixed-row layout |
| Control field and dropdown trigger | `ui/ControlField.jsx`, `dashboard.jsx::renderSprintControl` | `control-field`, `sprint-dropdown-toggle`, `sprint-dropdown-option` (`styles/shared/controls.css`, `styles/shared/header.css`); selected value, search-on-change | Ordinary overlay/ring, selected treatment plus ring; native fields preserve their existing field/focus rules; local scope or settings state | Reuse layout and focus tokens |
| Menu options | `issues/IssueFieldOptionMenu.jsx` | Status, priority, Project Track options | Row tint; delegates to registered handler | Preserve own-key target |
| Inline text edits and links | `issues/IssuePersonEditor.jsx`, `issues/IssueSummaryEditor.jsx`, `issues/IssueTeamEditor.jsx`, `issues/StoryPointsEditor.jsx` | Assignee/delivery owner, Summary, Team, Story points; Planning's Add assignee (`eng/PlanningAssigneeAddPicker.jsx`) wraps `IssuePersonEditor` with `matchQuery={null}` (its results carry no email), `emptyLabel="Add assignee"` and `maxOptions={10}` | Underline; editors write `activeEditor.issueKey`, links write nothing; the Add assignee wrapper writes the assignee capacity store (application storage, a row with a name snapshot), never a Jira field | Scale cleanup in spec #3 |
| Chart segments, legends and readouts | `stats/ProjectTrackSprintChart.jsx`, `stats/ExcludedCapacityLineChart.jsx` | `project-track-sprint-segment` (`styles/stats/project-track.css`), `stacked-bar--strip` (opt-in `variant="strip"` of `stats/StackedBar.jsx`, a 5px label-less strip that fills its host and takes the pointer there, resolving the segment at the pointer's x on a `row.total` axis, with `readoutLineCount` for multi-line readouts; the Planning assignee underbar wraps it with `planning-assignee-underbar`, which covers the whole capacity track below the capacity markers, draws the part beyond the Team Cap marker as `planning-assignee-overflow` with a reused `capacity-bar-fill-label` "+N SP over" label, and tints each person's table row `planning-assignee-tinted` with the segment colour, only while the strip is drawn and only for people with a segment; the assignee palette is the stats palette without lemon, magenta and amber, so no person matches the Unassigned pink or the amber bar and cue text), `excluded-capacity-line-point` (`styles/stats/excluded-capacity.css`), `burnout-legend` (`styles/stats/burnout.css`); dimmed, isolated, hovered/readout states. Settings -> Admin -> Performance reuses the grammar in `settings/PerformanceBoardWeeks.jsx`: `performance-week-segment`, `performance-week-legend-item` (native `aria-pressed` buttons on `burnout-legend`, no hover paint, like `effort-type-split-legend-item`), `performance-week-hover-bubble` on the shared `burnout-hover-*` rows, and its table buttons `performance-sort`, `performance-week-pick`, `performance-load-toggle` (foundation overlay plus inset ring) (`styles/settings/performance.css`). `settings/PerformanceCatchUpWeeks.jsx` reuses the same legend, readout and `performance-phase` hooks, extended with the `is-avg`, `is-median` and `is-p95` slugs (colour plus circle, square and diamond shape) and the SVG-only `performance-line-path` and `performance-line-point`, plus `performance-week-counts`, which lets only the readout's counts row wrap instead of truncating; `ExcludedCapacityLineChart` is not reused because its API is Team, Sprint and percent specific | Existing readouts; never infer Jira writes from a click | Keep readable readout and no global lift |
| Hover-reveal controls | `issues/IssueCard.jsx`, `eng/EpicBlock.jsx` | `task-remove` (`styles/eng/issues.css`), `epic-refresh-button` (`styles/eng/epics.css`); hover, focus-within, busy/error and touch fallbacks | Reveal only; tap remains available | Preserve touch behavior |
| Derived column marker | `eng/PlanningReviewTable.jsx::DerivedMarker` with `eng/EpicHeaderValueReadout.jsx` (`alwaysOn` mode) | `planning-review-derived-marker` (`styles/eng/planning-review-table.css`): a native button, superscript "S" (Story property on an Epic view) or "E" (Epic property on a Story view), zero-height 24px-wide inline-block with an absolute 24×24 `::before` hit area; leads a numeric heading, trails a text heading; the docked/real copy that is not reachable is `tabIndex -1`, `aria-hidden` and suppressed | Unframed tinted circle on the hit area; opens its readout by mouse hover, focus-visible or a tap that pins it; writes nothing. Not a registry hook (no hook suffix) | Reuse for any other derived-column marker |
| Inherited-view hint and its dismiss | `eng/PlanningReviewTable.jsx` (hint row) with `ui/IconButton.jsx` | `planning-review-hint` wrapper row (`styles/eng/planning-review-table.css`) holding one `planning-review-guidance` line and a small `IconButton` dismiss (`icon-button--sm` plus the existing `planning-review-column-action`, named "Dismiss layout hint"); shown after the capability, error, form-error and recovery lines and hidden while any shows. Not registry hooks (no hook suffix) | Unframed tinted circle of `planning-review-column-action`; works by tap; dismissal is a private browser preference, no write | Reuse for any other dismissible guidance line |
| Pinned alert row, Back and dismiss | `eng/AlertPinBar.jsx` with `ui/IconButton.jsx`; state and helpers in `eng/alertPin.js` | `alert-story--pinned` (`styles/eng/alerts.css`), a row-layout modifier of `.alert-story` that sets a fixed 40px single-line grid and draws it as a card like the filter bar card (the existing 10px radius and `1px solid var(--border)`, page-background corners); Back is an `IconButton` (`icon-button--sm` plus the existing `planning-review-column-action`); dismiss is the existing `task-remove alert-remove`. The modifier is deliberately not a registry hook (it is not a pill, chip or button kind) | Back reuses the unframed tinted circle of `planning-review-column-action` (its border is transparent); dismiss keeps `alert-remove` feedback; both visible without hover, 24px hit areas, tap works. The modifier styles its category tone by `[data-tone]` (`missing`, `empty`, `blocked`, `following`, `done`, from `ALERT_CATEGORY_STYLE` in `eng/alertPin.js`): a 3px inset left accent and the matching `alerts-panel-summary-pill` tint over `--bg-primary`, the tone colour on the label only (a darker `--alert-pin-label` for the orange and red tones, for 4.5:1), and the card header's icon before the label. The title (`alert-story-main`, `role="button"` as in the list rows) goes to the alert's Story or Epic (or Story requirement) through the list row's own handlers; a Missing info pin goes to the Story but does not open the Story Points editor that its row title opens. No Jira write and no status pill | Reuse for any other pinned single-line alert row |
| Draggable cards | `eng/EngBoardEpicCard.jsx`, `eng/EngBoardView.jsx` | `ecard`, `ecard-open`, `is-dragging`, `is-rejected` (`styles/eng/board.css`) | Whole-card column border/soft shadow; inner `ecard-open` stays transparent without its own ring. Drop writes dragged Epic key only | No child or selected-task propagation |
| Non-interactive cards / rows | Existing surface components | Passive containers | No new hover or write | None |

Selected controls retain meaningful fills, ink, borders and selection shadows; hover adds a ring without an overlay. Separate existing-hook pseudo rings preserve the shared segmented selection shadow, Settings selected swatch stroke and Stats selected graph-card elevation. Pending controls retain their locks and settlement; disabled controls gain no hover delta. Existing focus-visible outlines, native-field focus treatments and keyboard behavior remain; this migration does not unify every historical focus color. Consumed tokens are `--hover-ring`, `--hover-ring-inset`, `--hover-overlay`, `--overlay-pct`, and `--motion-hover`. Sticky tiers, dropdown layers, touch fallbacks and hover-reveal behavior remain. Tooltip placement and hover z-index lifts are distinct from movement effects; MRT009 documents their constraints.

Share destination contract (verified 2026-10-15): `dashboard.jsx::renderEpicShareControl` is the explicit optional callback passed to `EpicBlock` and `PlanningReviewTable`. It renders only in Catch Up/Planning; synthetic rows have no action, and a Planning table Story row takes the same control with `issueKind="story"` (a `story=` link target, Planning only). Header confirmation names the View; Epic and Story confirmations name their key locally. Scope, surface and target changes invalidate pending clipboard feedback; the hook-owned transient copy owner coordinates newer attempts across separate controls. Apply notices remain on the active header only. Ordinary success uses only the existing two-second checkmark, copied tooltip and destination-specific accessible status, with no visible panel or Dismiss. Genuine warnings reuse the compact `.jira-export-toast`; selectable manual URLs reuse the neutral `.jira-export-menu`, with an existing `secondary compact` Dismiss. Epic warnings/manual fields sit at the viewport bottom so Table/header layers cannot cover them; header feedback stays under the active header. Shared export CSS owns warning font family (the existing main-header IBM Plex Mono) and menu body typography using existing menu-item scales and feedback text defaults; attribute-scoped rules handle placement and margins only; recovery banners remain for recovery. No new class, font, radius, issue write or analytics parameter is introduced. Geometry, touch, layering and headed glyph contracts: `tests/ui/share_view_control.spec.js`; source and callback contracts: `tests/test_share_view_control.js`, `tests/test_eng_controls.js`.

## Measured CSS inventory

The Part 3 migration inventory recorded 49 CSS source files, 225 actual `:hover` selector occurrences across 40 files, 7 font-family values, 52 font sizes, 27 border radii and 41 full suffix-matching element class hooks. Current bundle inspection after the explicit Share amendment (2026-10-15) measures 49 files, 228 hover selector occurrences across 40 files and 18 offender identities. The Share amendment reuses the existing scales and class set; its discovery selectors only reveal paint/pointer interaction. The EPM fonts alignment (2026-10-29, #319) moved the EPM project name, update text and owner avatar onto the app font and removed the system sans stack, leaving six font-family values in the baseline.

Raw sources contain 12 exact `transform: none` declarations and 45 unrelated `text-transform: none` declarations. Hover/active blocks contain two right-edge tooltip placement resets and five non-none placement/reveal transforms. No declaration uses `transition: all`. The final generated baseline has 18 offender identities (eight transform identities and ten shadow identities), down from Part 1's 122 and Part 2's 106. All 87 removed Part 3 allowances are stale entries; the 2026-10-15 browser-layout repair removes one further allowance by making the Initiative tooltip end-aligned with an opacity-only reveal. No allowance has been added or changed. Duplicate tooltip selectors retain distinct source/context/occurrence identities. Ratchets reject stale entries, additions and changed values.

The retained offender identities have concrete purposes (their exact source/context/occurrence values remain unchanged):

| Owner / hook | Identities | Purpose |
| --- | ---: | --- |
| `eng/board.css` — `.eng-board .ecard:hover` | 1 | Approved outer-card soft shadow |
| `eng/issues.css` — priority icon `::after` | 1 | Place priority readout above its glyph |
| `epm/project-board.css` — progress tooltip, desktop/narrow contexts | 2 | Reveal and position progress readout |
| `planning/capacity.css` — marker tooltip | 2 | Readout shadow and horizontal placement |
| `planning/capacity.css` — fill tooltip, both duplicate occurrences | 3 | Readout shadow/centering and right-edge reset |
| `planning/capacity.css` — stuck-panel fill tooltip duplicate | 1 | Right-edge placement reset under sticky panel |
| `planning/capacity.css` — variance tooltip | 1 | Readout shadow |
| `planning/capacity.css` — excluded-note tooltip | 1 | Readout shadow |
| `planning/stat-cards.css` — project fill tooltip | 2 | Readout shadow and centering |
| `planning/stat-cards.css` — Team card tooltip | 1 | Readout shadow |
| `planning/stat-cards.css` — variance-gauge tooltip | 1 | Readout shadow |
| `planning/stats.css` — statistic-label tooltip | 1 | Readout shadow |
| `stats/project-track.css` — `.stacked-bar-strip:hover` | 1 | Existing chart-strip inspection feedback |

## Implemented hover vocabulary and retained exceptions

Ordinary buttons, including existing action anchors styled as buttons, use the 8% currentColor overlay plus ring inside `(hover: hover)`. Native and ARIA-disabled eligibility uses zero-specificity guards. Interactive semantic pills retain their original brightness and tints; clipped Table/dependency controls use the inset ring. Unframed icons use a tinted circle and their original readable or semantic hover ink; framed non-circular icons, including header, Planning actions, capacity rails, issue remove/refresh and EPM collapse, use the 8% overlay and ring within their existing border shape; links and inline text actions underline; Settings section tabs use a neutral bottom hover underline and retain the selected accent underline without button shading/rings; actual menu options tint their row. Passive issue/alert rows and wrappers gain no clickable feedback. Existing action-reveal and tap paths remain available.

Every migration is measured on actual mounted consumers, including shared CSS used outside its owning directory. Checks pin settled control boxes, text ranges, fonts/spacing, actual descendant ink and composed fills, preserved border radius/width/style, circle paint matching any visible frame, positive ring/circle/underline/tint, clipped ring pixels, selected-state treatment and disabled no-delta. General ordinary text requires 4.5:1 and ring/card contrast 3:1; glyph-only icons require 3:1. Tests: [`design_system_hover_eng.spec.js`](../tests/ui/design_system_hover_eng.spec.js), [`design_system_hover_surfaces.spec.js`](../tests/ui/design_system_hover_surfaces.spec.js), [`test_design_system_hover_foundation.js`](../tests/test_design_system_hover_foundation.js).

Retained presentation exceptions are explicit:

- Folded Board `.col-strip` draws the shared 8% overlay and inset ring on its pseudo-element above the chart fill. Its ordinary outset button hover shadow is suppressed so all four edges stay inside the clipped control; breach shadows remain separate. Native tooltip, focus behavior, chart fill, and Board geometry are unchanged.
- Board `.ecard` owns its column-border/soft-shadow feedback; `.ecard-open` stays transparent without an inner ring and retains its focus outline and Enter activation.
- The operator-approved Skip onboarding hover keeps the original darker red `#d9363e`, white ink and token ring only. Resting red and pending/disabled colors stay unchanged; measured hover text is 4.61785:1.
- Scenario native lane labels retain their operator-approved original blue hover tint and semantic child ink, with the inset ring and no overlay. Green status text retains its existing 3.1621:1 hover contrast instead of degrading under the ordinary overlay; gray metadata remains 5.2434:1. Existing focus paint stays separate.
- Chart segments, legends, isolation/dimming and contained pointer readouts retain their chart grammar. The Excluded Capacity legend keeps its exact original tint/glow; Project Track's strip keeps its intentional hover shadow. Tooltip/readout shadows, positional transforms, responsive placement resets and layer lifts are retained for their actual purposes, rather than deleted to force a zero baseline.
- Planning Product/Tech summary segments use locally approved pale tints with dark labels; Ad Hoc keeps its striped Product treatment. The dashed target remains above hovered segments. This presentation correction does not change the app-wide semantic palette.
- Existing semantic contrast debt remains deferred: white-on-blue statuses, amber metadata, orange Missing pills, selected gold glyphs and expanded Add status preserve their recorded palettes. New circle fills can change a glyph's composition; exact ink/fill/ratio checks record that result rather than claiming identical contrast. Existing muted chart details retain their opacity and palette; principal chart readout text remains separately measured.
- Planning List's excluded Epic ancestor retains opacity 0.55. Exact starting/current JSON and ring PNG are identical; actual painted text/fill contrast is 2.27231:1 and muted ring/card contrast 2.06316:1. Its narrow test pins the exact ancestor, token ring, brightness, palette and painted colors; it does not lower general contrast thresholds. Correcting this pre-existing dimming debt is separate scope.

The own-issue write registry, API effects and host/call-site bindings below remain unchanged. Spec #3, palette correction and keyboard-only enhancements remain deferred; no new event or persistence contract is introduced.

## Write ownership and effect inventory

All four mutation hooks are called once in `App` in `frontend/src/dashboard.jsx`. Presentational menus and editors receive handlers and never import Jira writers or write hooks. The queue, captured auth context, per-issue optimistic state and confirmed/rejected/unconfirmed settlement stay inside those existing owners. The API can accept arrays for status and priority, but UI writers construct singleton arrays; this document grants no bulk-write authority.

The six status JSX sites are Story and subtask in IssueCard, Epic in EpicBlock, Story and Epic in EngBoardEpicPanel, and the Planning table cell in App. Shared IssueCard/EpicBlock sites serve Catch Up and Planning list. The menu forwards its exact `issue` prop; App forwards `issue.key`. Board drop uses the same handler with the dragged Epic key. Priority derives its key from its own issue; Project Track receives the displayed Epic’s `epicKey`. Four editor components use `openEditor` descriptors at the recorded sites and submit through the controller's frozen `activeEditor.issueKey`. The capacity card submits its capacity issue (`candidate.issueKey`), through App's `updateCapacity` adapter.

`fetchIssueTransitionOptions` and `searchIssueFieldUsers` use POST for option reads. HTTP method alone does not classify a mutation. Every export of `jiraIssueApi.js` and `capacityApi.js` is listed by effect below. Application-storage writes have reasoned exemptions and retain their separate backend ownership, CSRF and permissions. Scenario Jira publication stays blocked; storage exemptions cannot authorize it. The controller's `updateField` dependency is a test seam, not a production option or a writer override.

The single JSON block is the machine-readable source for paths, symbols, imports, hosts, bindings and class names. Class hooks are the actual bundled suffix-matching selectors; they are an inventory, not permission to duplicate an existing kind. No new class, writer, call site or hook host is implicit.

```json
{
  "version": 1,
  "verifiedOn": "2026-10-13",
  "classHooks": [
    "alert-chip",
    "alert-pill",
    "alerts-panel-summary-pill",
    "cohort-open-jira-button",
    "cohort-selected-chip",
    "component-chip",
    "dependency-pill",
    "eng-filter-status-pill",
    "epic-refresh-button",
    "epic-status-pill",
    "epm-duplicates-fix-button",
    "epm-duplicates-project-chip",
    "epm-project-collapse-all-button",
    "epm-scope-chip",
    "group-gear-button",
    "group-star-button",
    "header-icon-button",
    "issue-type-chip",
    "jira-export-icon-button",
    "mapping-delivery-owner-chip",
    "mapping-parent-chip",
    "mapping-sp-chip",
    "mapping-team-chip",
    "planning-action-button",
    "planning-button",
    "planning-icon-button",
    "planning-review-text-button",
    "product-chip",
    "project-type-btn",
    "remove-btn",
    "scenario-badge",
    "scenario-date-badge",
    "segmented-control-button",
    "selected-team-chip",
    "status-pill",
    "story-requirement-pill",
    "tech-chip",
    "uncheck-button"
  ],
  "hooks": [
    {
      "path": "frontend/src/eng/useEngStatusTransitions.js",
      "symbol": "useEngStatusTransitions",
      "host": "frontend/src/dashboard.jsx",
      "hostSymbol": "App",
      "calls": 1,
      "api": "transitionIssues"
    },
    {
      "path": "frontend/src/eng/useEngPriorityTransitions.js",
      "symbol": "useEngPriorityTransitions",
      "host": "frontend/src/dashboard.jsx",
      "hostSymbol": "App",
      "calls": 1,
      "api": "updateIssuePriorities"
    },
    {
      "path": "frontend/src/eng/useEngProjectTrackTransitions.js",
      "symbol": "useEngProjectTrackTransitions",
      "host": "frontend/src/dashboard.jsx",
      "hostSymbol": "App",
      "calls": 1,
      "api": "updateIssueProjectTrack"
    },
    {
      "path": "frontend/src/eng/useEngIssueFieldEdits.js",
      "symbol": "useEngIssueFieldEdits",
      "host": "frontend/src/dashboard.jsx",
      "hostSymbol": "App",
      "calls": 1,
      "api": "updateIssueField"
    }
  ],
  "apiEffects": [
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchEditableIssueField",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngIssueFieldEdits.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "searchIssueFieldUsers",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngIssueFieldEdits.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "updateIssueField",
      "effect": "jira-write",
      "owners": [
        "frontend/src/eng/useEngIssueFieldEdits.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchIssueTransitionOptions",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngStatusTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "transitionIssues",
      "effect": "jira-write",
      "owners": [
        "frontend/src/eng/useEngStatusTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchIssuePriorityOptions",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngPriorityTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "updateIssuePriorities",
      "effect": "jira-write",
      "owners": [
        "frontend/src/eng/useEngPriorityTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchIssueProjectTrackOptions",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngProjectTrackTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "updateIssueProjectTrack",
      "effect": "jira-write",
      "owners": [
        "frontend/src/eng/useEngProjectTrackTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchIssueStatusCatalog",
      "effect": "read",
      "owners": [
        "frontend/src/eng/EngBoardView.jsx"
      ]
    },
    {
      "path": "frontend/src/api/capacityApi.js",
      "symbol": "fetchCapacity",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngCapacity.js"
      ],
      "aliases": {
        "frontend/src/eng/useEngCapacity.js": "requestCapacity"
      }
    },
    {
      "path": "frontend/src/api/capacityApi.js",
      "symbol": "updateCapacity",
      "effect": "jira-write",
      "owners": [
        "frontend/src/dashboard.jsx"
      ]
    }
  ],
  "components": [
    {
      "path": "frontend/src/issues/StatusTransitionMenu.jsx",
      "symbol": "StatusTransitionMenu"
    },
    {
      "path": "frontend/src/issues/PriorityTransitionMenu.jsx",
      "symbol": "PriorityTransitionMenu"
    },
    {
      "path": "frontend/src/issues/ProjectTrackTransitionMenu.jsx",
      "symbol": "ProjectTrackTransitionMenu"
    },
    {
      "path": "frontend/src/issues/IssuePersonEditor.jsx",
      "symbol": "IssuePersonEditor"
    },
    {
      "path": "frontend/src/issues/IssueSummaryEditor.jsx",
      "symbol": "IssueSummaryEditor"
    },
    {
      "path": "frontend/src/issues/IssueTeamEditor.jsx",
      "symbol": "IssueTeamEditor"
    },
    {
      "path": "frontend/src/issues/StoryPointsEditor.jsx",
      "symbol": "StoryPointsEditor"
    }
  ],
  "status": {
    "component": "frontend/src/issues/StatusTransitionMenu.jsx",
    "handlerProp": "onSubmit",
    "forward": "onSubmit?.(targetStatus, issue)",
    "keyBinding": "issue.key",
    "callSites": [
      {
        "path": "frontend/src/issues/IssueCard.jsx",
        "issues": [
          "task",
          "subtask"
        ],
        "handler": "onSubmitStatusTransition"
      },
      {
        "path": "frontend/src/eng/EpicBlock.jsx",
        "issues": [
          "{ key: epicGroup.key, status: epicStatus, summary: epicTitle }"
        ],
        "handler": "handleSubmitStatusTransition"
      },
      {
        "path": "frontend/src/eng/EngBoardEpicPanel.jsx",
        "issues": [
          "task",
          "{ key: epicKey, summary, status: epic.status }"
        ],
        "handler": "onSubmitStatusTransition"
      },
      {
        "path": "frontend/src/dashboard.jsx",
        "issues": [
          "{ key: row.key, status: row.status, summary: row.summary, storyPoints: row.issue?.fields?.customfield_10004 }"
        ],
        "handler": "handleSubmitStatusTransition"
      }
    ],
    "handlerPath": "frontend/src/dashboard.jsx",
    "handler": "handleSubmitStatusTransition",
    "hook": "useEngStatusTransitions",
    "api": "transitionIssues",
    "hookHost": "frontend/src/dashboard.jsx"
  },
  "bindings": [
    {
      "component": "frontend/src/issues/PriorityTransitionMenu.jsx",
      "symbol": "PriorityTransitionMenu",
      "handler": "onSubmit",
      "hook": "useEngPriorityTransitions",
      "api": "updateIssuePriorities",
      "keyBinding": "issue.key",
      "forward": "onSubmit?.(option.id, issueKey)",
      "callSites": [
        {
          "path": "frontend/src/issues/IssueCard.jsx",
          "issue": "task",
          "handler": "onSubmitPriorityTransition"
        },
        {
          "path": "frontend/src/eng/EpicBlock.jsx",
          "issue": "{ key: epicGroup.key, priority: epicOwnPriority, summary: epicTitle }",
          "handler": "submitPriorityChange"
        },
        {
          "path": "frontend/src/eng/EngBoardEpicPanel.jsx",
          "issue": "issue",
          "handler": "priorityTransitions.submitPriorityChange"
        },
        {
          "path": "frontend/src/dashboard.jsx",
          "issue": "{ key: row.key, priority: row.priority, summary: row.summary }",
          "handler": "submitPriorityChange"
        }
      ],
      "hookHost": "frontend/src/dashboard.jsx"
    },
    {
      "component": "frontend/src/issues/ProjectTrackTransitionMenu.jsx",
      "symbol": "ProjectTrackTransitionMenu",
      "handler": "onSubmit",
      "hook": "useEngProjectTrackTransitions",
      "api": "updateIssueProjectTrack",
      "keyBinding": "epicKey",
      "forward": "onSubmit?.(option.value, epicKey)",
      "callSites": [
        {
          "path": "frontend/src/eng/EpicBlock.jsx",
          "key": "epicGroup.key",
          "handler": "submitProjectTrackChange"
        },
        {
          "path": "frontend/src/eng/EngBoardEpicPanel.jsx",
          "key": "epicKey",
          "handler": "projectTrackTransitions.submitProjectTrackChange"
        },
        {
          "path": "frontend/src/dashboard.jsx",
          "key": "row.key",
          "handler": "submitProjectTrackChange"
        }
      ],
      "hookHost": "frontend/src/dashboard.jsx"
    }
  ],
  "editors": {
    "components": [
      "IssuePersonEditor",
      "IssueSummaryEditor",
      "IssueTeamEditor",
      "StoryPointsEditor"
    ],
    "hook": "useEngIssueFieldEdits",
    "api": "updateIssueField",
    "keyBinding": "activeEditor.issueKey",
    "openSites": [
      {
        "path": "frontend/src/issues/IssueCard.jsx",
        "key": "task.key"
      },
      {
        "path": "frontend/src/eng/EpicBlock.jsx",
        "key": "epicGroup.key"
      },
      {
        "path": "frontend/src/eng/EngBoardEpicPanel.jsx",
        "key": "issue.key"
      },
      {
        "path": "frontend/src/dashboard.jsx",
        "key": "row.key"
      }
    ],
    "hookHost": "frontend/src/dashboard.jsx",
    "handler": "openEditor/submit"
  },
  "boardDrop": {
    "path": "frontend/src/eng/EngBoardView.jsx",
    "symbol": "EngBoardView",
    "handler": "onSubmitStatusTransition",
    "keyBinding": "epicKey",
    "forward": "onSubmitStatusTransition?.(status, { key: epicKey })",
    "hook": "useEngStatusTransitions",
    "hookHost": "frontend/src/dashboard.jsx",
    "api": "transitionIssues",
    "callSites": [
      {
        "path": "frontend/src/eng/EngBoardView.jsx",
        "key": "epicKey",
        "handler": "onSubmitStatusTransition"
      }
    ]
  },
  "capacity": {
    "path": "frontend/src/eng/PlanningTeamCapacityCards.jsx",
    "symbol": "PlanningTeamCapacityCards",
    "host": "frontend/src/dashboard.jsx",
    "handler": "updateCapacityRequest",
    "api": "updateCapacity",
    "keyBinding": "candidate.issueKey",
    "callSites": [
      {
        "path": "frontend/src/eng/PlanningTeamCapacityCards.jsx",
        "handler": "updateCapacityRequest",
        "key": "candidate.issueKey"
      }
    ]
  },
  "statusPill": {
    "path": "frontend/src/ui/StatusPill.jsx",
    "symbol": "StatusPill",
    "interactiveOwner": "frontend/src/issues/StatusTransitionMenu.jsx",
    "handlers": [
      "onClick",
      "onPointerEnter",
      "onPointerLeave",
      "onPointerDown"
    ]
  },
  "exemptions": [
    {
      "path": "frontend/src/api/sprintReviewApi.js",
      "reason": "Sprint review snapshots write application storage, not Jira issue fields."
    },
    {
      "path": "frontend/src/api/assigneeCapacityApi.js",
      "reason": "Per-Sprint assignee capacity documents write application storage, not Jira issue fields."
    },
    {
      "path": "frontend/src/api/configApi.js",
      "reason": "Workspace configuration and private preferences are storage writes; their ownership and edit gates remain independent."
    },
    {
      "path": "frontend/src/api/scenarioApi.js",
      "reason": "Draft save, rollback and reload affect application storage. Jira publication remains blocked and needs a separate write contract before enablement."
    },
    {
      "path": "frontend/src/settings/sharedExcludedCapacityToggle.js",
      "symbol": "saveSharedExcludedCapacityToggle",
      "reason": "Epic exclusion persists shared Department capacity configuration through saveGroupsConfig, never Jira status."
    }
  ],
  "classHookMap": [
    {
      "class": "alert-chip",
      "paths": [
        "frontend/src/styles/eng/alerts.css"
      ]
    },
    {
      "class": "alert-pill",
      "paths": [
        "frontend/src/styles/eng/alerts.css"
      ]
    },
    {
      "class": "alerts-panel-summary-pill",
      "paths": [
        "frontend/src/styles/eng/alerts.css"
      ]
    },
    {
      "class": "cohort-open-jira-button",
      "paths": [
        "frontend/src/styles/stats/cohort.css"
      ]
    },
    {
      "class": "cohort-selected-chip",
      "paths": [
        "frontend/src/styles/stats/cohort.css"
      ]
    },
    {
      "class": "component-chip",
      "paths": [
        "frontend/src/styles/settings/group-board.css",
        "frontend/src/styles/settings/group-editor.css",
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "dependency-pill",
      "paths": [
        "frontend/src/styles/eng/dependencies.css"
      ]
    },
    {
      "class": "eng-filter-status-pill",
      "paths": [
        "frontend/src/styles/eng/filter-bar.css"
      ]
    },
    {
      "class": "epic-refresh-button",
      "paths": [
        "frontend/src/styles/eng/epics.css"
      ]
    },
    {
      "class": "epic-status-pill",
      "paths": [
        "frontend/src/styles/eng/epics.css"
      ]
    },
    {
      "class": "epm-duplicates-fix-button",
      "paths": [
        "frontend/src/styles/epm/duplicates.css"
      ]
    },
    {
      "class": "epm-duplicates-project-chip",
      "paths": [
        "frontend/src/styles/epm/duplicates.css"
      ]
    },
    {
      "class": "epm-project-collapse-all-button",
      "paths": [
        "frontend/src/styles/epm/project-board.css"
      ]
    },
    {
      "class": "epm-scope-chip",
      "paths": [
        "frontend/src/styles/settings/epm-settings.css",
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "group-gear-button",
      "paths": [
        "frontend/src/styles/settings/modal-shell.css",
        "frontend/src/styles/shared/controls.css"
      ]
    },
    {
      "class": "group-star-button",
      "paths": [
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "header-icon-button",
      "paths": [
        "frontend/src/styles/shared/controls.css"
      ]
    },
    {
      "class": "issue-type-chip",
      "paths": [
        "frontend/src/styles/settings/jira-fields.css",
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "jira-export-icon-button",
      "paths": [
        "frontend/src/styles/eng/export.css"
      ]
    },
    {
      "class": "mapping-delivery-owner-chip",
      "paths": [
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "mapping-parent-chip",
      "paths": [
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "mapping-sp-chip",
      "paths": [
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "mapping-team-chip",
      "paths": [
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "planning-action-button",
      "paths": [
        "frontend/src/styles/eng/planning-review-table.css",
        "frontend/src/styles/planning/actions.css"
      ]
    },
    {
      "class": "planning-button",
      "paths": [
        "frontend/src/styles/stats/summary.css"
      ]
    },
    {
      "class": "planning-icon-button",
      "paths": [
        "frontend/src/styles/planning/actions.css"
      ]
    },
    {
      "class": "planning-review-text-button",
      "paths": [
        "frontend/src/styles/eng/planning-review-table.css"
      ]
    },
    {
      "class": "product-chip",
      "paths": [
        "frontend/src/styles/settings/jira-fields.css"
      ]
    },
    {
      "class": "project-type-btn",
      "paths": [
        "frontend/src/styles/settings/jira-fields.css"
      ]
    },
    {
      "class": "remove-btn",
      "paths": [
        "frontend/src/styles/settings/epm-settings.css",
        "frontend/src/styles/settings/group-board.css",
        "frontend/src/styles/settings/group-editor.css",
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "scenario-badge",
      "paths": [
        "frontend/src/styles/scenario/timeline.css"
      ]
    },
    {
      "class": "scenario-date-badge",
      "paths": [
        "frontend/src/styles/scenario/timeline.css"
      ]
    },
    {
      "class": "segmented-control-button",
      "paths": [
        "frontend/src/styles/shared/controls.css",
        "frontend/src/styles/shared/header.css",
        "frontend/src/styles/stats/shell.css"
      ]
    },
    {
      "class": "selected-team-chip",
      "paths": [
        "frontend/src/styles/settings/group-editor.css",
        "frontend/src/styles/settings/jira-fields.css",
        "frontend/src/styles/settings/mapping-preview.css",
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "status-pill",
      "paths": [
        "frontend/src/styles/eng/board.css",
        "frontend/src/styles/eng/planning-review-table.css",
        "frontend/src/styles/eng/status-transitions.css"
      ]
    },
    {
      "class": "story-requirement-pill",
      "paths": [
        "frontend/src/styles/eng/issues.css"
      ]
    },
    {
      "class": "tech-chip",
      "paths": [
        "frontend/src/styles/settings/jira-fields.css"
      ]
    },
    {
      "class": "uncheck-button",
      "paths": [
        "frontend/src/styles/planning/stat-cards.css"
      ]
    }
  ]
}
```

## Adding an element or write

1. Find its kind above and reuse its primitive, class and hover vocabulary. Stop for review before introducing another class for the same kind.
2. For a write, record the component, handler, owning hook/host, effect, call site and exact own-key binding in this registry; add a source pin and synthetic own-key test before connecting it.
3. Preserve selected, disabled, pending, touch and auth-expired behavior. Keep components presentational and production writers non-injectable.
4. Generate and inspect the CSS baseline with `node scripts/generate_design_system_baseline.cjs`. Font-family, font-size, radius and suffix-class changes need a reasoned review; the generator creates allowances only when no baseline exists and thereafter rejects additions or changed grandfathered values, allowing only stale removals. Duplicate selectors and nested contexts retain separate identities.
5. Run the write guards and CSS ratchets, rebuild, and use settled per-control Playwright geometry and screenshots for any visible hover or layout change. Existing mutation analytics stay unchanged; Parts 1 and 2 are covered by the No-Event Allowlist.

Checks: [write contract guards](../tests/test_design_system_write_contract.js), [CSS ratchets](../tests/test_design_system_ratchets.js), [status binding tests](../tests/test_design_system_status_binding.js), [runtime matrix](../tests/ui/design_system_status_contract.spec.js). CSS baselines preserve exact values and property identities (`text-transform` is not `transform`); existing option/queue iteration is valid and never widens mutation targets.
