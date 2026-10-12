# Design system map, write contract and hover system

| Field | Value |
| --- | --- |
| Date | 2026-10-12 |
| Status | Design, awaiting operator review. No implementation plan yet; run `writing-plans` after approval. |
| Scope | Spec #1 + #2 of three. Spec #3 (shared `Button`, font-size/radius/spacing scales) is a separate follow-up. |
| Branch | Rename `cld/design-system-mapping-9d27d1` to `improvement/design-system-hover-contract` before the first commit (MRT022). |

## Goal

Make the UI simpler, more readable and easier for a new user by: (1) writing down which repeatable design elements exist and how they interact, so a display element can never be wired to a wider write than its own issue; (2) one hover and focus language across the app, with no enlarge or lift effects.

## Verified baseline (2026-10-12, grep counts are approximate)

- `docs/ontology.md` is domain-only; there is no UI or design-system layer and no design doc. Guidance is scattered through AGENTS.md section 11.
- Shared UI primitives in `frontend/src/ui/`: `StatusPill`, `IconButton`, `SegmentedControl`, `ControlField`. There is no shared `Button`.
- About 36 bespoke pill/chip/badge classes; `.task-status` is a legacy class that must mimic `.status-pill`.
- Global `button` / `button:hover` in `frontend/src/styles/eng/controls.css` applies a dark fill, `translateY(-1px)` lift and `transition: all .3s`. Components fight it with about 125 `transform: none` overrides and about 15 `button.<name>` resets.
- 202 `:hover` occurrences across 13 CSS files: mixed background, box-shadow, border, underline and opacity changes. Only the global rule, `styles/eng/alerts.css` and `styles/settings/group-editor.css` actually lift.
- Tokens: four `:root` blocks (main one in `frontend/src/styles/shared/shell.css`); no hover, focus, motion, font-size, spacing or radius-scale tokens.
- Write API callers (verified by grep): `useEngStatusTransitions` (`transitionIssues`), `useEngPriorityTransitions` (`updateIssuePriorities`), `useEngProjectTrackTransitions` (`updateIssueProjectTrack`), `useEngIssueFieldEdits` (`updateIssueField`). The API functions in `frontend/src/api/jiraIssueApi.js` accept a payload, and the transition option read takes `issueKeys`; the single-key rule is therefore enforced at the hook and component layer and by the existing behavior specs, not by the API signature.
- Existing hover test: `tests/ui/pill_hover.spec.js` (reads `frontend/dist/dashboard.css`).

## Decisions (operator-confirmed in brainstorming)

1. Spec #1 and #2 are designed together; the map includes each element's hover kind.
2. Hover rule: no movement or size change; colour and border changes only. Shade and darken stay allowed.
3. Enforcement of the write contract is API shape plus a source-guard test (no runtime assertion).
4. Rollout: foundation first with a ratcheting guard and baseline allowlist, then one commit per surface, one PR.
5. The write contract is one machine-readable `json` block inside `docs/design-system.md`; the doc is the single source.
6. Button scope: hover only; the global `button` keeps its geometry. No shared `Button` in this spec.

## Hover and focus vocabulary

| Kind | Hover | Focus-visible |
| --- | --- | --- |
| Pills, chips, filter cards | Glow border, text colour unchanged | Stronger glow |
| Filled buttons | Fill darkens one step plus glow border | Stronger glow |
| Secondary and transparent buttons | Light tint plus glow border | Stronger glow |
| Inline text edit | Underline | Underline plus glow |
| Icon buttons | Tinted circle | Stronger glow |
| Menu options | Row tint | Row tint plus glow |
| Non-interactive cards and rows | None | n/a |

Rules: no `transform`, `scale` or `translate*` in `:hover` or `:active`; no `transition: all`; every hover shade keeps readable text contrast (no dark-on-dark); every action works by tap, none requires drag.

## Design

### A. Interaction foundation

New `frontend/src/styles/shared/interaction.css`, imported with the other shared partials:

- Tokens: `--hover-ring`, `--focus-ring`, `--hover-tint`, a `color-mix` darken step for filled controls, `--motion-hover` (one short duration; transitions limited to `color`, `background-color`, `border-color`, `box-shadow`).
- Rules written once as grouped selectors listing existing class hooks per kind (for example `.status-pill`, `.task-status`, `.chip`, `.selected-team-chip` under the pill kind). No new class names for elements that already have one.
- Five kind hooks (token, button, text-edit, icon, option) exist only as the documented home for new elements.
- The global `button:hover` loses its transform and fixed dark fill; only genuinely dark-filled buttons keep a darken-on-hover.
- Sticky offsets, z-index tokens and the `:has(.sprint-dropdown-panel)` layer lift are not touched (MRT009).
- Out of scope: keyframe deduplication and entrance animations (for example the duplicated `board-breach-glow`). The map notes them.

### B. Design-system map: `docs/design-system.md`

Sections: Principles (reuse before create; one kind, one look, one hover; hover means clickable; nothing moves or resizes); Element kinds table (kind, canonical component, existing class hooks, allowed variants, hover kind, writes yes/no, target variant for spec #3); Interaction rules (the vocabulary above, contrast, touch); Write contract; Adding a new element (find the kind, reuse its component and hook, a new class for an existing kind is a review-stop). `docs/ontology.md` gains a UI-layer entry linking the doc, with a verification date and resolvable paths. AGENTS.md section 10 conventions gains one line pointing to the doc.

### C. Write contract and guard tests

The doc holds one fenced `json` block listing each write element: component, hook, API function, key rule. Entries to verify against source at planning time:

- `StatusTransitionMenu` / `useEngStatusTransitions` / `transitionIssues`
- `PriorityTransitionMenu` / `useEngPriorityTransitions` / `updateIssuePriorities`
- `ProjectTrackTransitionMenu` / `useEngProjectTrackTransitions` / `updateIssueProjectTrack`
- `StoryPointsEditor`, `IssuePersonEditor`, `IssueSummaryEditor`, `IssueTeamEditor` / `useEngIssueFieldEdits` / `updateIssueField`

Key rule for every entry: writes only its own `issueKey`; the Planning selection never widens a write. `StatusPill` is display-only; its `interactive` button form is allowed only as the trigger inside a listed write component.

Guard tests, modelled on `tests/test_status_column_colours_source_guards.js`:

1. Contract block exists, parses, and every listed file and symbol resolves.
2. Write API functions are imported only by the listed hooks.
3. The listed hooks are called only by the listed components.
4. `StatusPill` receives no write handler outside the listed components.
5. Hover ratchet: no `transform`/`scale`/`translate*` in `:hover`/`:active` and no `transition: all`, except entries in a baseline allowlist generated from today's offenders; each surface commit shrinks the allowlist.

Existing behavior specs (`eng_status_transitions.spec.js`, `eng_priority_transitions.spec.js`, `eng_issue_field_edits.spec.js`) keep covering the behavior side.

## Rollout

0. `git pull`, rename the branch.
1. Foundation commit: `interaction.css`, `docs/design-system.md`, ontology entry, AGENTS.md pointer, both guard tests with the baseline allowlist.
2. One commit per surface in this order: shared header and global `button`, ENG, Planning, EPM, Settings, Stats. Each deletes that surface's `transform: none` overrides and bespoke hover rules, removes its allowlist entries, and adds Playwright assertions for every control kind on that surface (sibling audit, not only the reported instance).
3. Closing commit: allowlist empty except documented exceptions, docs final, `npm run build` output committed.

## Verification (each run by command before any success claim)

- Guard tests pass; the allowlist is empty except documented exceptions.
- `pill_hover.spec.js` extends into a table-driven spec covering every element-kind row: bounding box unchanged, ring/underline/tint present, text contrast kept, measured after transitions settle. Rebuild before running (the spec reads `frontend/dist/dashboard.css`).
- Full Python suite, JS tests and the full Chromium `tests/ui` run pass. Form-control and emoji geometry rechecked headed in Firefox and WebKit.
- Before and after screenshots per surface with animations settled; live data in the open authenticated dashboard is checked numbers-only and nothing is saved.
- Analytics: restyle only, no new event; the allowlist reason is documented in the plan.

## Risks

- Sticky and dropdown layering regressions: mitigated by not touching offsets or z-index and by per-surface commits with screenshots.
- A hover shade that fails contrast: mitigated by the table-driven contrast assertion.
- Unmapped legacy classes: the map records them with their target variant; merging them is spec #3.

## Open items for the implementation plan

- Re-verify every component, hook and symbol in the contract entries against source.
- Generate the hover baseline allowlist from a script, not by hand.
- Confirm which of the 13 hover CSS files belong to which surface commit.
