# Design system map, write contract and hover system (design)

| Field | Value |
| --- | --- |
| Date | 2026-10-13 (revision 2) |
| Status | Design, validated by four read-only reviews on 2026-10-13; awaiting operator review. Not an implementation plan: after approval, write the `EXEC-` plan with `writing-plans`. |
| Scope | Specs #1 and #2 of three. Spec #3 (shared `Button`; font-size, radius and spacing scales; JSX inline styles) is a separate follow-up. |
| Branch | `improvement/design-system-hover-contract`, merged with `origin/main` on 2026-10-13. |

## Goal

Make the UI simpler, more readable and easier for a new user: (1) write down which repeatable design elements exist and how they interact, so a display element can never be wired to a wider write than its own issue (an Epic status pill must not change its Stories); (2) stop new deviations: fewer new elements, fonts and button variants; (3) one hover and focus language with no enlarge or lift effects.

## Decisions (operator-confirmed)

1. Specs #1 and #2 are designed together; the map records each element's hover kind.
2. Hover rule: no movement or size change; colour and border change only. Shade and darken stay allowed.
3. Foundation: tokens consumed by the existing classes' own selectors. No grouped selector lists, no new kind hook classes, no new cascade layer.
4. Delivery: three PRs (PR1 contract, map and guards; PR2 global hover fix; PR3 surface migration), each independently shippable.
5. Write-contract enforcement: API shape plus source guards. No runtime assertion.
6. One machine-readable `json` block inside `docs/design-system.md` holds the write contract and the hook registry; the doc is the single source.
7. Ring: option A, `0 0 0 1px #2f80ed, 0 0 0 3px rgba(47, 128, 237, .25)` (about 3.9:1 on white; 1.95:1 against the In-Progress fill), with an inset variant for cells that clip overflow.
8. Buttons: an overlay of the button's own text colour at 8% (drawn as an inset shadow, so it also works over inline fills) plus the ring. No new `Button` component.
9. Interactive pills keep today's resting look (no new resting cue). Pill hover keeps `filter: brightness(.94)` and the existing semantic hover tints; only the ring changes.
10. Ratchets in PR1: font-family, font-size, border-radius, hover offenders, and new pill/chip/badge/button class names.
11. AGENTS.md: five binding rules in section 10; section 11 learnings that go stale are updated or retired in the PR that removes their cause.
12. Underline stays the hover for links and inline text edits.

## Validated baseline (merged tree, 2026-10-13; counts approximate, re-measured by the plan)

- `docs/ontology.md` is not domain-only: it already maps status/priority mutations, inline issue edits, pills and the single-key rule. `docs/DOMAIN_ONTOLOGY.md` is the domain-only file. There is no design-system document.
- Shared primitives in `frontend/src/ui/`: `StatusPill`, `IconButton`, `SegmentedControl`, `ControlField`. No shared `Button`. `.task-status` is co-applied with `.status-pill` (not a legacy stand-in).
- Hover: 206 `:hover` occurrences in 41 CSS files (not 13), shared across surfaces. 80 `transform: none` (the 45 further `text-transform: none` are unrelated). Only three real lifts: the global `button:hover`, an alert rule and a settings group-editor rule. 10 `transition: all`, including the global button rule. 14 to 17 hover rules use elevation shadows.
- Global `button` / `button:hover` / `button.secondary:hover` in `styles/eng/controls.css`: dark fill, 1px lift, `transition: all .3s`. Any button without its own override takes them: a static estimate puts 54 to 90 of 278 buttons on the dark fill, and about 18 light buttons flash dark on hover.
- The blue 2px ring is a literal at three selectors (`eng/status-transitions.css`, `eng/dependencies.css`, `stats/priority.css`), not a token. `--focus-ring` is not declared anywhere, but `eng/alerts.css` reads `var(--focus-ring, #2563eb)` as an outline colour: declaring it as a shadow would silently remove that outline.
- Four `:root` blocks (main one `styles/shared/shell.css`). `--radius` and `--epm-project-hover-surface` exist; there are no hover, focus, motion, font-size or spacing tokens.
- 52 distinct font sizes, 27 border radii and 7 `font-family` declarations (4 families plus fallback variants); 17 JSX lines set `fontFamily`, `fontSize` or `borderRadius` inline.
- Write path: the four write hooks (`useEngStatusTransitions`, `useEngPriorityTransitions`, `useEngProjectTrackTransitions`, `useEngIssueFieldEdits`) are each called once, in `dashboard.jsx`; components receive handlers as props. `StatusTransitionMenu` derives the key from its own `issue` prop but calls `onSubmit?.(targetStatus)` without it. Its six call sites bind the key in an inline closure, independent of `issue=`. The sibling Priority and Project Track menus pass the key. `transitionIssues` and `updateIssuePriorities` take `issueKeys[]` (backend cap 50); only `updateIssueField` and `updateIssueProjectTrack` are single-key by shape. `updateCapacity` (a Jira PUT from the Planning capacity cards) is a write the first inventory missed.
- Tests: `tests/test_*.js` run in CI (`npm run test:frontend:unit`); `tests/ui` has no CI job by decision and is the local gate. Several tests pin the current hover literals (see "Tests expected to change").

## Delivery: three PRs

### PR1: contract, map and guards (no visible change)

- `StatusTransitionMenu` calls `onSubmit(targetStatus, issue)` with its own `issue` prop, like its siblings; the six call sites pass the handler bare. `dashboard.jsx` stays within its structure budget (line-neutral or smaller).
- `useEngStatusTransitions` rejects a non-string key instead of coercing it (`String(['A', 'B'])`).
- `docs/design-system.md`; UI-layer entry and updated existing entries in `docs/ontology.md`; five binding rules in AGENTS.md section 10; a No-Event Allowlist row in `docs/README_ANALYTICS.md`; deferred items in `docs/TODO.md`.
- Tokens declared in `styles/shared/shell.css` and unused: `--hover-ring`, `--hover-ring-inset`, `--hover-overlay` (with `--overlay-pct: 12`), `--focus-ring-color`, `--motion-hover`. The one existing `--focus-ring` read in `eng/alerts.css` is renamed to `--focus-ring-color` with the same colour.
- Guard tests and baselines (section D below).

### PR2: global hover fix (visible, app-wide)

The global `button`, `button.secondary` and `:disabled` hover rules and the base `transition: all` (controls.css); the alert and group-editor lifts; the remaining `transition: all`; the three ring literals replaced by `var(--hover-ring)`; disabled controls get no hover. Every consumer surface is screenshotted, because this changes an estimated 54 to 90 buttons at once. Offenders leave the ratchet baseline here.

### PR3: surface migration

One commit per CSS-ownership group, ordered so shared files go first: shared and dropdown triggers, ENG (split in parts), Planning, EPM, Settings, Stats, Scenario (missing from revision 1). Several files serve more than one surface (the ENG issue, status, dependency and epic files serve ENG, Planning and EPM; `.epic-stat-toggle` lives in `stats/priority.css` but renders in ENG and Planning), so each commit is screenshotted on every consumer surface. Each commit deletes its bespoke hover rules and `transform: none` resets (resets only after the global lift is gone), moves the element onto the tokens, adds element-level Playwright assertions for every control kind on that surface, and shrinks the baselines. If the diff proves too large for review at planning time, the plan splits ENG out instead of changing the order.

## Design

### A. Write contract

Revision 1's guard 3 (hooks called only by components) failed on today's code, and its import-graph guards could not stop an Epic pill writing its Stories: that regression needs no new import, hook call or handler. The contract is therefore pinned at the call sites. Each entry records `component`, `callSites`, `handlerProp`, `hookHost`, `hook`, `api` and `keyBinding`, by path (never line numbers; the dashboard decomposition is in progress).

- Entries: status (`StatusTransitionMenu`, `transitionIssues`), priority (`PriorityTransitionMenu`, `updateIssuePriorities`), Project Track (`ProjectTrackTransitionMenu`, `updateIssueProjectTrack`), the four field editors (`updateIssueField`; the key is `activeEditor.issueKey`, set at the editors' `openEditor` call sites), Board drop (single key through the status hook), and `updateCapacity` (key: the capacity issue).
- `exempt` entries with a reason for multi-key writes to the application's own database: Sprint review save, Epic exclude toggle, scenario save/rollback/reload, configuration savers. Scenario Jira publish is always blocked today and needs its own entry before it is enabled.

Guards (`tests/test_design_system_write_contract.js`, in CI):
1. The block parses and every listed file and symbol resolves.
2. Write API functions are imported only by their listed hook (and `updateCapacity` by its listed host). Every `jiraIssueApi` export is classified read or write; alias, namespace and dynamic imports are covered; injected writers (the `updateField` option) are forbidden.
3. Each hook is called exactly once in `frontend/src`, in an allowlisted host file.
4. None of the listed components imports a hook or an API function (extends the existing EPM pin to all seven).
5. Every `<StatusTransitionMenu>` passes `onSubmit` as the bare handler, the menu itself calls `onSubmit(targetStatus, issue)`, and the call-site count is pinned (a new site needs a registry entry).
6. Negative pin: the four hooks and the status handler contain no iteration over selected or child tasks.
7. `StatusPill` receives no `on*` handler or spread outside the listed menus (comments stripped; the passive span spreads `...props`).
8. Behaviour: a table-driven Playwright spec per call site (Catch Up Story, subtask and Epic; Planning list and table; Board panel Epic and Story; Board drop) with an Epic that has two or more Stories: one request, `issueKeys` equal to the clicked key only, child pills unchanged. This is a local gate.

Existing own-key coverage stays: the Board drop guard (its status-closure pin is updated for guard 5), `test_planning_issue_mutations.js`, and the `eng_status_transitions`, `eng_priority_transitions` and Board drag/panel specs. `eng_issue_field_edits.spec.js` is an editor harness without API routes; field-key coverage lives in the node tests.

### B. Tokens and hover vocabulary

Existing classes keep their selectors and consume the tokens; there are no grouped class lists. Pill hover applies only to interactive elements (`button.status-pill` and the like); passive spans get none. Hover is gated by `@media (hover: hover)`. Final vocabulary:

| Kind | Hover |
| --- | --- |
| Interactive pills, chips | Ring A; `brightness(.94)` and semantic tints stay; inset ring in clipped cells |
| Buttons (filled, secondary, transparent, light) | 8% text-colour overlay plus ring A; nothing moves |
| Inline text edit, links | Underline |
| Icon buttons | Tinted circle |
| Menu and dropdown options | Row tint |
| Chart segments, legends and readouts | Their existing in-app readout rules; no global button lift; assertion kept |
| Hover-reveal controls | Existing touch fallbacks stay |
| Non-interactive cards and rows | None |
| Disabled | No hover |
| Selected | Keeps its selected treatment; hover adds only the ring |

Focus is restyle only. Outline stays for `:focus-visible` (several tests pin outlines), the colour comes from `--focus-ring-color`, and no keyboard behaviour is built (keyboard-only accessibility is deprioritized; findings go to `docs/TODO.md` Deferred). Touch: every action still works by tap and none requires drag.

### C. Map, ontology and AGENTS.md

- `docs/design-system.md`: principles (reuse before create; one kind, one look, one hover; hover means clickable; nothing moves or resizes); an element-kind table (canonical component, existing class hooks, variants, hover kind, writes yes/no, target variant for spec #3) including the kinds revision 1 omitted (chart segments and legends, hover-reveal controls, selected/disabled/pending states, dropdown triggers, draggable cards); the hook registry and write contract in one `json` block; an "adding a new element" checklist.
- `docs/ontology.md`: add a UI-layer entry and update the existing status/priority mutation, inline edit and pill entries (aliases, entry points, tests, relationships, verification date, resolvable paths). Append rather than editing the Coverage line, which `origin/main` also edits.
- AGENTS.md section 10 gains five binding rules: look up the kind and reuse its component and hook (a new class for an existing kind is a review-stop); hover and focus come from the tokens, with no transform in `:hover`/`:active` and no `transition: all`; a write element writes only its own issue key, and a new write path needs a contract entry and a call-site pin; a new font-family, font-size or border-radius value or pill/chip/badge/button class needs a ratchet allowlist entry with a reason; hover and geometry changes ship with element-level Playwright assertions per control kind. Stale section 11 learnings are updated or retired in PR2 or PR3.
- Feature docs that describe hover (for example `docs/features/planning-sprint-review.md`) are updated in the PR that changes them.

### D. Ratchets (PR1, data only)

`tests/test_design_system_ratchets.js`, in CI, parses `frontend/src/styles/dashboard.css` bundled in memory with esbuild (`write: false`, no new dependency, comments stripped, one declaration per line). Shrink-only allowlists in one data file under `tests/` are generated from today's values by a script, not by hand. Each key is `file :: at-context :: one selector :: property[: value]`; the property is matched exactly (so `text-transform` is not a transform). The test fails on a new entry and on a stale one, and stores the value so a grandfathered `none` cannot become a lift.

- Hover offenders: `transform`/`scale`/`translate` in `:hover`/`:active`, `transition: all`, and hover shadows that are not `none`, a `0 0 0 Npx` ring or an inset shape.
- Documented exception categories: tooltip-placement transforms (positional, not lifts), z-index-on-hover rules (MRT009), hover-reveal rules.
- Value sets: distinct `font-family`, `font-size` and `border-radius` values.
- Class names: any new `*-pill`, `*-chip`, `*-badge`, `*-btn` or `*-button` selector must appear in the hook registry.
- Out of scope here: the 17 JSX inline-style lines (spec #3).

## Verification (each run by command before any success claim)

- Per PR: full Python suite, `npm run test:frontend:unit`, the full Chromium `tests/ui` run, and a clean `npm run build` with `make verify-dist-clean`. Rebuild dist in every commit: several specs and guards read `frontend/dist`.
- Hover specs run against real surfaces (the existing synthetic-DOM fixture cannot see ancestor-scoped survivors), with one assertion set per control kind: bounding box unchanged, ring or underline or tint present, text contrast kept, measured after transitions settle. Add a static check that no residual hover override remains on a mapped hook.
- Form-control and emoji geometry rechecked headed in Firefox and WebKit; screenshots with animations settled; any live-data checks stay read-only and nothing is saved.
- Contrast: ring A at least 3:1 against the card; text on any hover fill keeps its readable ratio.
- Analytics: restyle only, so one No-Event Allowlist row in `docs/README_ANALYTICS.md` (anchors, trigger/event_type/event_name none, feature_name, params none, date); the drift check in `tests/test_analytics_source_guards.js` stays green.
- Publication per PR follows the section 10 transaction (fetch base, record SHAs, compare the commit list and changed paths with this design, build at the proposed head, read back the rendered PR body, CI state) and MRT025.

## Tests expected to change (named by the reviews; the plan re-verifies each)

- PR1: the Board drop guard's status-closure pin, and the EPM and Planning-action pins on hook and API imports.
- PR2 and PR3: `pill_hover.spec.js` and `planning_selection_defaults.spec.js` (ring literal, deliberately updated to ring A); the three negative `rgb(47, 47, 47)` assertions (they go vacuous: replace them); `planning_review_table.spec.js`, `eng_epic_refresh.spec.js` and `eng_missing_story_ghosts.spec.js` (hover `box-shadow: none` for chips and secondary buttons becomes ring assertions); `test_eng_board_styles.js`, `test_epm_view_source_guards.js` (including its pinned EPM elevation shadow), `test_excluded_capacity_stats_source_guards.js`, `test_dashboard_alert_source_guards.js` and `test_dashboard_css_extraction.py` (pinned CSS text or `.project-bar-fill:hover` in dist). Never loosen a test to make it pass; update it to the decided behaviour and say so.

## Parked (not in this design)

Keyboard-only focus work (`docs/TODO.md` Deferred); keyframe deduplication and entrance animations (for example the duplicated `board-breach-glow`); a resting cue for interactive pills (operator kept today's look); a shared `Button`, the font-size, radius and spacing scales and the JSX inline styles (spec #3).

## Risks

- Sticky and dropdown layering: sticky offsets, z-index tokens and the `:has(.sprint-dropdown-panel)` lift are not touched (MRT009). New dropdowns inside the animated filters strip still need the layer lift.
- PR2 changes many buttons at once: mitigated by screenshots of every surface and the contrast assertion.
- Shared CSS files: mitigated by ordering commits by file ownership and screenshotting every consumer surface.
- Ratchet false positives: mitigated by the exact-property match and the three exception categories.
- Ring clipped in `overflow: hidden` cells: mitigated by the inset variant and a pixel-level assertion.

## Open items for the implementation plan

- Re-verify every component, hook, symbol and test name above against source at the merged base; paths only, no line numbers.
- Generate both baselines from a script; confirm the baseline key for the one colliding selector.
- Decide the exact guard-5 source pattern and the negative-pin strings; list the files each PR may touch and the forbidden regressions (`docs/AGENTS.md`).
- Run `npm ci` in this worktree before any build, and set `JEP_TEST_PYTHON` for the UI specs.

## Validation record

Four read-only reviews on 2026-10-13 (write-contract call paths, hover/CSS feasibility, repo-rule compliance, goal fit and UX) found revision 1 not ready for planning. They corrected the baseline counts, the foundation architecture (grouped selector lists), the rollout (one PR), the write contract (guards that could not stop the motivating regression), the ring strength and the missing element kinds. A standalone specimen built from the repo's verbatim CSS settled ring strength, button hover and the resting cue; the operator's choices are decisions 7 to 9.

Operator refinement (2026-10-14): reduce ordinary-button dimming from 12% to 8%. Framed header icon buttons follow their rounded-square border with the shared overlay/ring; unframed icon circles retain their existing treatment. The original 12% inert-token delivery notes above are historical. Geometry, selected states, disabled gates and semantic exceptions remain unchanged.

Operator shape correction (2026-10-14): icon hover follows any visible non-circular border, including Planning action pills, capacity rail controls and issue remove/refresh buttons. These use the 8% overlay/ring without changing the existing border radius or geometry. Circles remain appropriate for unframed icons and genuinely circular frames. Mounted checks now reject circular paint inside non-circular visible borders and pin radius/width/style.
