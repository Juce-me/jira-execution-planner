# Epic header visible-height correction plan

Status: planned — DESIGN-GATED; STOP before implementation; not execution-ready
Date: 2026-09-10
Type: bugfix
Current accuracy: proposed contract for the dirty worktree application baseline `7d605e7`, with subsequent documentation-only HEAD `ddf8099786c6ca97a2684d837aa7eb51ca49cbdc`; not implemented or published.

## Goal and forbidden regressions

Make the ENG epic headline one aligned desktop row with equal visible item height, readable typography and accessible controls. Follow [the validated analysis](SUPPORT-epic-header-visible-height-analysis.md). Every item must be checked, including all icons and conditional Included/Excluded control. Equal DOM heights or text bottoms alone are insufficient.

Do not stack desktop metadata, shrink text to fit, hide whole required fields, change status meanings or labels, replace existing interaction flows, reset current person values, alter endpoint payloads/permissions, add dependencies, widen the app shell, redesign mobile or change EPM/Group Board layouts. Preserve every unrelated dirty edit. No commit, push or PR is authorized by this plan. This document is not an execution handoff.

## Required visual contract and unresolved design gate

The user's strict requirement is unchanged: all visible headline items have identical painted height and aligned top/bottom edges on one desktop row, with readable accessible content. No final size or typography specification has been selected. The earlier draft's 20 CSS px painted band is **unvalidated and not an implementation instruction**: preserving mixed fonts at that painted height may exceed the available row width. Independent review rejected treating it as execution-ready.

Plain text items are measured by glyph ink; icons by actual artwork including strokes; status and Included/Excluded controls by their painted outer surface, with their internal labels separately checked for readable scale and centering. Compare top, bottom and height across items, allowing at most 1 CSS px for raster edges in a pinned reference rendering, never deliberate visual-scale differences. Status label height must be reported too; a matching pill silhouette cannot excuse tiny text. This measurement interpretation must be shown explicitly in the feasibility evidence so it cannot mask the original defect.

Strict actual-ink equality across arbitrary strings is not established: capitals, x-heights, descenders and mixed fonts vary. **There is no automatic descender exception.** Do not introduce per-string font scaling, stretching, clipping, a canonical-string-only PASS, or waive failing real labels. If one stable type specification per role cannot meet the strict requirement for representative varied labels and documented supported content, the design gate fails. Present measured alternatives and obtain the user's explicit decision before relaxing ink equality, changing the typography/artwork system or proceeding. Optical similarity is not silently substituted for exact visible equality.

Readability and accessibility remain hard gates: text at least 14 CSS px, including pill labels; transparent interactive targets at least 24×24 CSS px with spacing; normal text contrast 4.5:1 and meaningful icons/focus indicators 3:1. These are proposed minimum checks, not a claim that the current UI meets them. Measure the current palette and use only scoped corrections retaining semantic hues. Keep the existing font families/artwork initially; do not swap emoji or global design tokens without an explicit design decision.

Desktop evidence must cover 988, 1280, 1440 and 1920 viewport widths and actual content-container widths. Fit is one row without overlap. Show complete values when space permits; use existing title ellipsis first and constrain only exceptionally long person values while preserving complete accessible names and keyboard/pointer full-value discovery. No global font shrinking, hiding required fields, desktop horizontal scrolling, or metadata wrapping. Exact minimum title/person allocations are outputs of the feasibility gate, not the earlier draft's unproven 12ch/10ch promises. Until those readable allocations and longest supported fixed fields fit together, implementation remains blocked. Existing below-760px behavior is a preservation check, never substitute evidence.

## Allowed file map

All listed existing paths have been checked to exist. Re-read them and their instruction chain before execution.

| File | Allowed change |
| --- | --- |
| `frontend/src/styles/eng/issues.css` | Primary scoped ENG header layout, typography, artwork sizing, fit, focus and contrast rules; remove superseded header-only 24px/offset assumptions |
| `frontend/src/dashboard.jsx` | Minimal epic-headline-only class/span/accessibility hooks if CSS cannot address paint/readonly content; preserve handlers, gates and shared renderer |
| `tests/ui/eng_group_board_card.spec.js` | Replace biased geometry criteria; add complete painted-item and fit/interaction cases with synthetic data |
| `tests/ui/eng_issue_field_edits.spec.js` | Only needed header current-value, keyboard, width and recovery regression coverage |
| `tests/test_eng_board_styles.js` | Replace obsolete style-source expectations, preserve meaningful scope guards |
| `docs/README_ANALYTICS.md` | Add/tighten no-new-event allowlist reason for presentation-only correction |
| `docs/postmortem/MRT028-epic-header-instruction-drift.md` | On execution only, correct resolution/evidence status without claiming acceptance or publication |
| `docs/postmortem/README.md` | On execution only, keep the corresponding incident status aligned |
| `docs/plans/README.md`, this plan and its analysis | Keep review/execution state honest |
| `frontend/dist/dashboard.css`, `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map` | Generated only via build after source changes |

Existing shared `epics.css`, `status-transitions.css`, `IssuePersonEditor.jsx`, transition components/hooks, `EngView.jsx`, fixture shell, backend and global shell are read-only dependencies. If implementation needs to change those beyond a local header hook, revise the concrete file map and obtain direction before widening scope. Existing shared editor fixes and dirty mobile work are preserved, not reverted wholesale.

## Tasks and verification gates

### 0. Resolve visual feasibility before implementation

This is a read-only design task. Do not edit product CSS/JS, shared assets or permanent tests to explore candidates. Diagnostic scripts may live only in ignored `tmp/` and measure the unchanged renderer/font metrics without applying candidate styles.

Inventory actual font availability, current content width and every painted role. Use browser canvas `measureText` including actual bounding-box ascent/descent and screenshot evidence for SVG/emoji/strokes and controls. For each proposed stable per-role font size/band, calculate the combined width budget at the narrowest desktop container: all icons, gaps, key, status, SP, capacity control, and usable title/person segments. Also measure loaded-font and fallback states; computed font-family names alone are insufficient.

Use explicit combined synthetic stress fixtures rather than one long value at a time: a long title with ascenders/descenders; 16-character issue key; a long multiword status such as `Ready for Deployment`; decimal total `9999.9`; `Excluded` control; a long multiword person name; all applicable icons. Repeat with uppercase-only and descender-heavy titles/names, short names, absent fields, editable/readonly rendering, query text and all track/priority values. This defines a required sample, not a promise that every possible Jira string has bounded width.

Before the gate can pass, record an evidence table with proposed font/paint sizes, measured full-content and truncated budgets, remaining title/person width, actual ink-top/bottom/height spreads, supported conditions and per-fixture verdicts. No sample can be silently removed. Exact actual-ink equality that cannot be achieved by stable typography must be reported as a design conflict, not addressed with per-label scaling. The user's decision is required for any relaxation. A feasibility failure or unavailable loaded fonts keeps the plan design-gated.

**Current result: NOT PASSED.** The original mismatch is reproduced; candidate sizing, loaded fonts and combined readable width have not been validated. No product or permanent test implementation may begin, even after a general instruction to execute, until this gate is resolved or the user explicitly changes the visual contract.

### 1. Freeze baseline and tests before changing appearance

Read current diff, record head and checksums for pre-existing changes; confirm branch and remote freshness when available. Re-read instructions/postmortems and every named target. Keep local work in the current checkout. Do not execute if unrelated concurrent edits overlap the planned patch.

Promote the diagnostic idea into permanent assertions that fail on the current UI. Test all painted items, not only text. Capture settled full-row and item crops, preserve device-scale metadata and normalize image coordinates to CSS pixels. Use actual foreground/background segmentation per item and require nonempty painted regions; a white status glyph mask must exclude white outside the pill. Include glyph tops/bottoms/heights, SVG stroke bounds, emoji paint and control surfaces. Keep text-label readability and vertical centering as separate checks inside painted controls. Establish the oracle on the rejected baseline before candidate CSS.

Record loaded fonts via browser font APIs and actual successful font resources; `document.fonts.ready` with an empty font stylesheet is not proof. Existing fixture intentionally uses fallback fonts. For real-font evidence use the existing font service via a fixture override during diagnostics or an already installed equivalent resource; do not install a dependency or claim fallback screenshots validate loaded fonts. Missing font availability blocks loaded-font visual acceptance, not the source analysis. Capture fallback separately. Pin browser/platform/DPR for comparisons, then check DPR1/2 and browser zoom100/125/200; at effective desktop widths enforce the same row contract, at narrower widths verify existing accessibility/reflow without substituting mobile evidence.

### 2. Apply minimal scoped visual correction

Use scoped CSS and existing renderer hooks. Normalize all visible item metrics and common vertical alignment together; remove only obsolete header rules from this correction. Normalize actual SVG artwork envelopes without changing priority/track meaning. Preserve current text family, label casing and single-row structure. Implement the stated fit budget and full-value access, keeping menus outside clipping contexts. No content-dependent JavaScript font scaling or arbitrary per-string offsets.

After each coherent change, compare settled before/after crops to every requirement. Do not accept a good title/status pair while missing person/priority/track/capacity. A failed visual criterion blocks completion even if interaction tests pass.

### 3. Verify the supported states and preserve behavior

| Area | Required evidence |
| --- | --- |
| All row items | Top/bottom/height, no overlap, no unintended clipping, readable labels, focus and click geometry; status text and surface distinguished |
| Content | Short/long titles and names, key up to 16 characters, decimal/zero/large SP, short/long status, all priority/track values, missing person/status, NO_EPIC, readonly/editable input |
| State | Idle, hover, keyboard focus, editor opened before typing, long query, loading, save success, rejected save, stale/conflict recovery, retry/reload, pending/disabled; values and focus preserved |
| Menus/actions | Status/priority/track open/select/Escape/outside click; person keyboard navigation/select/cancel; title destination unchanged; Included/Excluded persistence and disabled gate; onboarding preview does not write |
| Surfaces | Catch Up, Planning, and Statistics list paths actually calling `renderEpicBlock`; plain and initiative-grouped epics; include capacity-control-present states |
| Layout protection | Planning panel above sticky epic header when open, epic top when closed; Catch Up/Planning/Scenario transitions; menus visible, clickable, bounded at edges and above sticky layers |
| Collateral guards | EPM issue boards, ENG Group Board compact cards, story/person editor outside header and existing narrow-screen behavior unchanged |
| Data flow | Existing mocked requests/payloads and auth-expired lock remain unchanged; no extra fetch/replay on resize, focus styling, truncation or font loading |

No new or changed routes: endpoint auth/workspace/CSRF/request/response migration matrix is **N/A**. No storage or ownership migration, SSE, polling, fan-out or startup change. User-visible edit state is tested through existing owners; no alternate editor state machine is introduced. A terminal API401 must retain the existing global recovery behavior, never local header recovery/replay.

### 4. Run checks, independent review and record evidence

Use installed Node20. Required commands after implementation:

```sh
npm run build
node --test tests/test_eng_board_styles.js tests/test_eng_issue_field_edits.js tests/test_dashboard_epic_icon_source_guards.js
node node_modules/@playwright/test/cli.js test tests/ui/eng_group_board_card.spec.js tests/ui/eng_issue_field_edits.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_priority_transitions.spec.js tests/ui/eng_project_track_transitions.spec.js tests/ui/planning_selection_defaults.spec.js --workers=1
git diff --check
```

Add assertions for missing matrix cells to the allowlisted test files rather than treating unrelated existing totals as coverage. Identify actual reachable Statistics and Scenario guards before reporting coverage; not every Statistics tab renders epic lists. Retain the build-generated files required by `.github/workflows/verify-frontend-build.yml`. No full Python suite is required for this CSS-only scope; any later publication follows the repository's separate full-suite and explicit publication authorization rules.

Provide an independent visual/spec reviewer the exact user constraints, baseline and final screenshots, the plan and current diff. Require per-item compliance first, then implementation review. Complete keyboard/focus/contrast and interaction checks before any completion claim. Record tested fonts, viewport/container widths, zoom/DPR, assertions, screenshots and limitations; no claim of universal raster equality. Update incident docs only with measured results. User visual acceptance remains distinct from test success.

## Analytics impact

No new event: layout/typography/artwork correction has no new product action. Existing controls retain their current `pageview`/`userevent` trigger contracts, canonical event names, feature identities and typed params. Add the presentation-only no-new-event reason to the existing allowlist during implementation; no new params, taxonomy event, dimension registration or GA4 runbook change. Existing event assertions must retain payloads and counts; no title/person/query/issue values enter telemetry.

## Independent plan validation

A separate read-only reviewer inspected the written contract and relevant source. Two P1 findings rejected the original numeric specification: (1) a 20px painted band plus large fixed-width metadata was not proven to fit the capped container; (2) strict per-string ink equality conflicted with an implicit descender exception. The plan now removes those unsupported implementation assumptions and adds the explicit read-only Task 0 gate. Final independent review: the correction workflow is sound and both P1 findings are addressed as explicit blocking design gates. The visual specification remains unvalidated and implementation is not ready. No additional blocking defect was found in the workflow itself. Residual risks are loaded/fallback font and emoji variation, strict per-label ink equality, and long fixed metadata within the capped container.

Backend endpoint/storage/workspace/auth migration coverage was reviewed and is inapplicable because none changes. Existing edit/recovery/401 states and request contracts remain regression obligations. No implementation is authorized or begun; a reviewed workflow does not mean the visual design has passed its gate.
