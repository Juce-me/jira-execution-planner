# Epic header visible-height correction plan

Status: implementation complete; verification in progress — pending user acceptance; not committed or published
Date: 2026-09-10
Type: bugfix
Review baseline: existing source/bundle was committed concurrently as `0bdda707d522937568657ae37e22a339cde32bd8`; this task made documentation and disposable specimen changes only.
Current accuracy: implemented in the local worktree from baseline `43d38b9cc3835bb3923c7ad63439f188fb5b9ec2`; source, generated bundle, regression tests, analytics documentation, and incident records reflect the contract below. A user-reported initiative-group regression exposed an overly narrow direct-child selector; the correction and exact grouped fixture now cover both plain and initiative-nested Epic headers. One required Project Track test still has an unresolved async-option timing failure outside this plan's allowed edit map. User acceptance, commit, and publication remain pending.

## Goal and forbidden regressions

Make the ENG epic headline one aligned desktop row with equal visible item height, readable typography and accessible controls. Follow [the validated analysis](SUPPORT-epic-header-visible-height-analysis.md). Every item must be checked, including all icons and conditional Included/Excluded control. Equal DOM heights or text bottoms alone are insufficient.

Do not stack desktop metadata, shrink text to fit, hide whole required fields, change status meanings or labels, replace existing interaction flows, reset current person values, alter endpoint payloads/permissions, add dependencies, widen the app shell, redesign mobile or change EPM/Group Board layouts. Preserve every unrelated dirty edit. No commit, push or PR is authorized by this plan. This document is not an execution handoff.

## Validated visual specification

The former exact-per-string painted-pixel gate was an authoring error. It converted visually consistent sizing into an impossible arbitrary-glyph constraint and delegated the resulting design problem to the user. It is removed. The correction is a single compact row with matched optical text size, normalized icon artwork and consistently sized control surfaces; visible rendering remains the acceptance target. Natural ascenders/descenders remain intact. No per-string scaling, stretching, clipped glyphs or tiny status labels.

The disposable specimen uses the actual current React renderer and synthetic API fixtures. It changes only the browser's temporary stylesheet. It is not a production patch. Local reproduction:

```sh
node node_modules/@playwright/test/cli.js test --config tmp/epic-header-specimen.config.js --grep 'validated header design|ordinary header'
```

| Role | Specification |
| --- | --- |
| Epic title | Crimson Pro 600, 16px, 24px line height; existing serif identity, single-line ellipsis |
| Key, SP, person, status and capacity text | IBM Plex Mono 14px, 24px line height (22px inside bordered24px pills); 400 body/500 interactive weights; Arial/sans-serif fallback to preserve optical scale when webfonts fail |
| Text calibration | Compare equivalent `Hx` cap/x-height samples per role; reference spread ≤1 CSSpx. Actual content receives screenshot review with natural glyph variation, not a false exact ink-height assertion |
| Leading icons |24×24px slots/targets; epic artwork16px, priority SVG18px with its internal whitespace, track emoji14px to avoid the former oversized circle. Person SVG21px yields roughly16px stroke envelope inside a20px slot; capacity SVG18px. Keep semantic artwork and normalize individual priority/track variants by painted bounds during implementation |
| Pills |24px surface height; same14px readable label scale as metadata. Status surface and label are reviewed separately; their equality is not asserted against plain text ink |
| Spacing |12px between title/meta groups;6px leading slots,8px title/key,10px metadata; existing row padding, no taller stacked metadata |
| Focus |2px contrasting inset outline on interactive controls, visible despite text clipping; no clipped external focus ring |

The local title/key link becomes a two-column grid: `minmax(110px,1fr) max-content`. The title wrapper and title row use intrinsic minimum sizing; title wrapper `flex:1 1 0`. Metadata uses `flex:0 1 auto; min-width:0; max-width:none`. Person removes the unconditional cap, uses a126px minimum outer allocation and preserves the existing intrinsic input width with `max-width:100%`. The status text is capped at140px with ellipsis; key and SP remain fully visible. This gives spare width to the name and protects a readable title segment when combined content is long. It does not require every extreme string to be fully visible simultaneously.

Keep all required fields present. Use a compact in-app full-value readout on hover and keyboard focus for truncated title, status and person; leave normal click, typing and menu behavior unchanged. Retain full accessible names, keep it visible while either trigger or readout is hovered or the trigger has keyboard focus; dismiss on Escape or after both hover/focus leave, and suppress it while an editor/menu is active so it does not cover interaction. This readout is a small implementation obligation, not something the specimen already implements. Native title text alone is insufficient. Truncated readonly values receive a focusable discovery span (`tabIndex=0` only when truncated), full accessible text and `aria-describedby` to the readout; existing links/inputs/buttons retain their native focus targets. Position readouts in the established overlay layer with viewport bounds; test pointer transfer into the readout, Escape dismissal, keyboard focus, scroll/edge placement and absence of menu interception. The status cap must apply to its text-bearing pill, not clip its menu wrapper. Keep readonly person text in a named span so clipping and full-value access match the input variant.

Preserve each status's semantic palette. The specimen demonstrates In Progress blue and an unknown-status neutral style only; its exploratory CSS must not be copied wholesale onto all statuses. Apply any necessary contrast correction per existing status class, including completed/blocked/killed states and readonly parity. Measured specimen text contrast: person 6.04:1, In Progress 7.46:1, neutral 8.39:1. Normal text must meet 4.5:1 and active meaningful icons/focus 3:1. Preserve disabled semantics.

## Completed design validation

Final combined run: **2 passed (24.5s)**, covering 20 rendering cases. Earlier separate runs: stress matrix 16 cases (19.8s), ordinary/focus matrix 4 cases (6.5s). Tested Catch Up and Planning at 988/1280/1440/1920 with actual local Crimson Pro/IBM Plex Mono font files and with fallback fonts; ordinary/focus cases at 988/1440 with loaded fonts. Font resources are explicitly loaded with `FontFace`, not inferred from CSS family names. Controlled text comes from fixture state; no transient input.value mutation is used.

| Evidence | Result |
| --- | --- |
| Stress available header width |920.41px at 988 viewport;972.41px at the wider viewports |
| Combined stress content |Long title, 16-character synthetic key, Ready for Deployment, SP9999.9, long person, leading icons, and Included control in Planning |
| Horizontal overflow and pairwise item overlap |0px in all 16 cases |
| Minimum visible title/name allocation |110px title;153.81px name with loaded fonts;165.22px name fallback |
| Equivalent text cap-height spread |0.60px loaded;0.79px fallback |
| Ordinary full name |Full 21-character name visible in all 4 cases, checked with actual text width |
| Focus |Inset outline visibly intact in inspected Planning/Catch Up crops |

Standalone before/after review artifact: `tmp/epic-header-design-preview.html`.

Evidence lives in ignored `tmp/epic-header-analysis/`: `specimen-results.json`, `ordinary-results.json`, `specimen.css`, `specimen-loaded-988-Planning.png`, `ordinary-loaded-988-Planning.png`, `focus-988-Planning.png` and corresponding matrix crops. This is design feasibility evidence, not final app regression verification. No product source, generated bundle or permanent test was changed. Remaining implementation checks below are normal verification work, not a request for the user to solve an invented design gate.

## Allowed file map

All listed existing paths have been checked to exist. Re-read them and their instruction chain before execution.

| File | Allowed change |
| --- | --- |
| `frontend/src/styles/eng/issues.css` | Primary scoped ENG header layout, typography, artwork sizing, fit, focus and contrast rules; remove superseded header-only 24px/offset assumptions |
| `frontend/src/dashboard.jsx` | Epic-headline-only readonly value span, full-value readout/accessible descriptions, Escape/focus/pointer handling and local class hooks; preserve existing handlers, gates and shared renderer |
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

### 1. Freeze baseline and tests before changing appearance

Read current diff, record head and checksums for pre-existing changes; confirm branch and remote freshness when available. Re-read instructions/postmortems and every named target. Keep local work in the current checkout. Do not execute if unrelated concurrent edits overlap the planned patch.

Convert the validated specimen criteria into permanent assertions that fail on the current UI. Test all painted items, not only text; never reinstate exact arbitrary-string ink equality. Capture settled full-row and item crops, preserve device-scale metadata and normalize image coordinates to CSS pixels. Use actual foreground/background segmentation per item and require nonempty painted regions; a white status glyph mask must exclude white outside the pill. Record real-label glyph tops/bottoms/heights, SVG stroke bounds, emoji paint and control surfaces. Assert equivalent-glyph optical calibration and role-specific painted sizes, and retain independent visual review of actual labels. Keep text-label readability and vertical centering as separate checks inside painted controls. Establish the oracle on the rejected baseline before candidate CSS.

Record loaded fonts via browser font APIs and actual successful font resources; `document.fonts.ready` with an empty font stylesheet is not proof. Existing fixture intentionally uses fallback fonts. For real-font evidence use the existing font service via a fixture override during diagnostics or an already installed equivalent resource; do not install a dependency or claim fallback screenshots validate loaded fonts. Use the already validated loaded-font fixture and the separate fallback case; missing resources must be reported, never represented as a loaded-font pass. Capture fallback separately. Pin browser/platform/DPR for comparisons, then check DPR1/2 and browser zoom100/125/200; at effective desktop widths enforce the same row contract, at narrower widths verify existing accessibility/reflow without substituting mobile evidence.

### 2. Apply minimal scoped visual correction

Use scoped CSS and existing renderer hooks. Apply the concrete 16px/14px typography, intrinsic title/key grid, uncapped flexible person width, status text ellipsis and inset focus treatment above; normalize visible metrics and vertical alignment together; remove only obsolete header rules from this correction. Normalize actual SVG artwork envelopes without changing priority/track meaning. Preserve current text family, label casing and single-row structure. Implement the stated fit budget and full-value access, keeping menus outside clipping contexts. Add full-value readout behavior through the existing renderer without replacing edit/menu handlers. No content-dependent JavaScript font scaling or arbitrary per-string offsets.

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

Add assertions for missing matrix cells to the allowlisted test files rather than treating unrelated existing totals as coverage. Identify actual reachable Statistics and Scenario guards before reporting coverage; not every Statistics tab renders epic lists. Retain the build-generated files required by `.github/workflows/verify-frontend-build.yml`. No full Python suite is required for this frontend-only scope; any later publication follows the repository's separate full-suite and explicit publication authorization rules.

Provide an independent visual/spec reviewer the exact user constraints, baseline and final screenshots, the plan and current diff. Require per-item compliance first, then implementation review. Complete keyboard/focus/contrast and interaction checks before any completion claim. Record tested fonts, viewport/container widths, zoom/DPR, assertions, screenshots and limitations; no claim of universal raster equality. Update incident docs only with measured results. User visual acceptance remains distinct from test success.

## Analytics impact

No new event: layout/typography/artwork correction has no new product action. Existing controls retain their current `pageview`/`userevent` trigger contracts, canonical event names, feature identities and typed params. Add the presentation-only no-new-event reason to the existing allowlist during implementation; no new params, taxonomy event, dimension registration or GA4 runbook change. Existing event assertions must retain payloads and counts; no title/person/query/issue values enter telemetry.

## Independent plan validation

The original review approved an unusable gated workflow and is superseded. Separate analysis review identified the invented arbitrary-glyph equality requirement and unreliable old task-zero screenshots. Separate plan review caught oversized track artwork, blanket status coloring, unconditional name caps and clipped focus. The specimen and contract address those findings with calibrated text, smaller track artwork, per-state palette requirements, intrinsic grid/flex allocation and inset focus. Final independent plan review inspected the rewritten contract, four representative crops and both result files. The plan is concrete and supported by the specimen; its readout hover-persistence/readonly-focus clarification is now incorporated. No unresolved design blocker remains. Full palette, conditional-state and functional verification remain explicit implementation work, not a completed claim.

No endpoint, auth, storage or ownership migration is proposed; those migration matrices remain inapplicable. The full interaction/readonly/401/sticky/analytics matrix above must be verified during implementation. Design validation does not claim functional regression tests already passed. Stop before implementation as requested.

## Outcome

Implemented in the local worktree. The production renderer now provides viewport-bounded full-value readouts for truncated Epic title, status, and person values; the scoped desktop CSS applies the validated one-row sizing and fit budget to both direct and initiative-grouped ENG Epic blocks; permanent source and Playwright coverage replaces the obsolete wrapper-only oracle. The generated frontend bundle and analytics allowlist are aligned. Verification evidence and any remaining environment limitations are recorded in the final execution report; no commit, push, PR, or user acceptance is claimed.
