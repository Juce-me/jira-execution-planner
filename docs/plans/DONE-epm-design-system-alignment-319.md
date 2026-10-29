> **Status:** Done. Executed on `improvement/319-epm-design-system-pills`. Kept for audit context only.


# EPM view: align project status and label pills with the ENG design system (#319)

Visual reference: [`assets/mockups/epm-design-system-319.html`](../../assets/mockups/epm-design-system-319.html) (built from the compiled `dashboard.css` and the real EPM/ENG markup; Option A is the approved direction).

## Problem

The EPM project board header uses two bespoke pill kinds while the epic and story rows beneath it already reuse ENG classes:

| Element | Today | ENG equivalent |
| --- | --- | --- |
| Project status | `epm-project-board-status-pill` (2px radius, weight 700, own lifecycle colours) | `status-pill task-status epic-status-pill <semantic>` (8px radius, shared palette) |
| Project Jira label | `epm-project-board-label-pill` (blue accent capsule, 999px radius, 0.6rem) | `epic-key` text (mono, `--text-secondary`, no chip) |
| Duplicates callout label | `epm-duplicates-project-label` (same blue capsule inside a chip) | `epic-key` text |

`docs/design-system.md` says one kind has one look and a new class for an existing kind is a review-stop.

## Decision (operator, 2026-10-29): Option A

Status uses the shared ENG epic pill; the label renders as ENG key text. Both bespoke pill hooks are deleted. Option B (neutral chip via `dependency-pill`) was rejected: it reuses a dependency-specific class for another meaning.

## Scope

In: project board header status pill, project board label, duplicates callout label, their tests, the design-system registry and baseline.

Out (listed as follow-ups, not touched): blue "Jira rollup" toggle, collapse-all button, update freshness chip, the mono "In Progress" pill in the progress row (`epm-project-progress-status`), Settings -> EPM chips. No data, endpoint, write path or analytics change; no event is needed (visual-only, record the allowlist reason in `docs/README_ANALYTICS.md` only if its checker requires one).

## Assumptions to verify before editing (Task 0)

1. Home lifecycle state values: enumerate `ACTIVE_EPM_PROJECT_STATES`, `BACKLOG_EPM_PROJECT_STATES`, `ARCHIVED_EPM_PROJECT_STATES`, `RECENT_COMPLETED_EPM_PROJECT_STATES` in `frontend/src/epm/epmProjectUtils.mjs`. The mapping below covers On track, At risk, Off track, Pending, Completed; my call for the rest (Paused, Cancelled, Archived, any other) is `waiting` (grey). Confirm against the enumerated sets and against the unstyled behaviour today (an unmapped class currently gets no fill).
2. The display text `Completed 🎉` must keep the pill's text unchanged; only classes change.
3. `getIssueStatusClassName` derives a class from the label text, so the lifecycle class (`on-track`, `at-risk`, ...) must be replaced by an explicit semantic class, not derived from text.

## Mapping

| Home state | New semantic class | Colour (shared `.task-status`) |
| --- | --- | --- |
| On track, Completed | `done` | `#52c41a` (same as ENG Done) |
| At risk | `postponed` | `#fa8c16` |
| Off track | `blocked` | `#ff4d4f` |
| Pending and every other state | `waiting` | `#8c8c8c` |

On track sharing ENG's Done green is accepted as the cost of the shared palette.

## Tasks

1. **Mapping helper.** Add `getEpmProjectStatusSemanticClass(stateLabelOrValue, { completed })` to `frontend/src/epm/epmProjectUtils.mjs` (pure, unit-tested, one place for the table above).
2. **Header pill.** In `EpmRollupPanel.jsx::renderPortfolioHeader`, render `StatusPill` with `status-pill task-status epic-status-pill <semantic>` (build with `['task-status', 'epic-status-pill', semantic]`, not `getIssueStatusClassName`). Keep `title`/`aria-label`.
3. **Label.** Replace the label `StatusPill` with `<span className="epic-key" title={project.label}>`; keep its position after the owner. Same for the duplicates callout label (`epm-duplicates-project-label`).
4. **CSS.** In `styles/epm/project-board.css` delete `.epm-project-board-label-pill` and every `.epm-project-board-status-pill*` rule; delete `.epm-duplicates-project-label` in `duplicates.css`. Add the only new rule: `.epm-project-board-title-meta` takes the ENG `.epic-meta` typography (mono, uppercase, `letter-spacing: 0.05em`, `--text-secondary`), with `.epm-project-board-owner` reset to `text-transform: none; letter-spacing: 0` and `.epic-key` inside it capped (`max-width: min(22rem, 100%)`, ellipsis, nowrap) so long labels keep truncating. No local override of `.task-status` geometry (MRT021).
5. **Registry and baseline.** Remove the two hooks from the pill registry and `classHookMap` in `docs/design-system.md`; regenerate `tests/design_system_baseline.json` with `node scripts/generate_design_system_baseline.cjs` (the ratchet is shrink-only; a rejected regeneration means something was added, stop and investigate). Update the "Verified on" date and the Status-pill row to name EPM as a consumer.
6. **Tests.** Update source guards and fixtures that name the removed classes: `tests/test_epm_view_source_guards.js` (lines near 414, 423, 426, 809, 819), `tests/test_dashboard_alert_source_guards.js` (~592, now assert the shared `.task-status.waiting` palette instead), `tests/test_dashboard_css_extraction.py` (~246), `tests/ui/epm_portfolio_header_visual.spec.js` (fixtures at 35, 40, 93, 98, 154, 159, 209, 214 and locators at 279-280), `tests/ui/design_system_hover_surfaces.spec.js` (~139: passive pill/label hover must still equal rest), `tests/ui/epm_sorting_controls.spec.js` (~157: completed pill is `.status-pill.task-status.epic-status-pill.done`, uppercase, `rgb(82, 196, 26)`). Add: helper unit tests for every row of the mapping; a Playwright test that the EPM header status pill's computed font, padding, radius, weight and background equal an ENG `.epic-status-pill` of the same semantic class; a label test (mono, `--text-secondary`, no border/background, ellipsis on a 60-character label, no horizontal overflow of `.epm-project-board-title-meta`) at desktop and 390px; one assertion per sibling element of the same kind on the surface (header status pill, epic status pill, progress pill, label, duplicates label) so a fix is never checked on one instance only.
7. **Docs.** `docs/features/epm-view.md`: one sentence that EPM status and label reuse the ENG pill and key text. Update `docs/postmortem` only if a regression occurs.
8. **Verification.** `npm run build`; single-file runs while iterating; then `python3 -m unittest discover -s tests`, `npm run test:frontend:unit`, `npx playwright test tests/ui --browser=chromium --workers=4`. Screenshot before and after of an EPM board in collapsed and expanded states (wait for animations to settle) and compare against the Option A mockup; verify at 390px and desktop. Verify in the user's authenticated localhost session read-only, keeping no screenshot of live data. Inspect the diff for unrelated lines before finishing.

## Acceptance

- Header status pill is visually and computationally identical to an ENG `epic-status-pill` of the same semantic class; no `epm-project-board-status-pill` or `epm-project-board-label-pill` remains in source, tests or docs.
- Project and duplicate-callout labels render as ENG key text, truncate with an in-app readable full-text `title`, and never overflow.
- Design-system baseline shrinks; no new class, font-size, radius or hook is added.
- Owner name keeps normal case; Completed still reads `Completed 🎉`.
- Full Python, frontend unit and Chromium UI suites pass at the proposed head.

## Risks

- Uppercase mono in `title-meta` can crowd narrow widths; Task 6 checks 390px and the label cap.
- Colour semantics: On track and Completed both read as Done green; revisit only if the operator objects.
- Unmapped states change from "no fill" to grey; Task 0 confirms which states exist.

## Outcome (2026-10-29)

Implemented as planned. Deviation: the header pill's classes come from `getIssueStatusClassName(getEpmProjectStatusSemanticClass(...), 'epic-status-pill')` rather than a raw `'task-status'` literal, so `tests/test_status_column_colours_source_guards.js` pins for `EpmRollupPanel.jsx` change to 3 calls and 3 pills. The duplicates-callout label also ellipsizes (`min-width: 0`, `overflow: hidden`).

Verification: `npm run test:frontend:unit` 3170 pass; full Python suite passed except two `test_local_postgresql_runner` SIGINT cases that pass alone (known load flake); full Chromium `tests/ui` 1998 passed, 3 failed in `dashboard_data_freshness.spec.js` (EPM automatic-refresh timing). That spec fails a varying subset on a stashed baseline without this change (4 failures there), so it is pre-existing and unrelated to pills; it was not fixed here. Headed Firefox/WebKit glyph checks were not run (no emoji or form-control geometry change).

## Current accuracy

Describes current behaviour: `epm-project-board-status-pill`, `epm-project-board-label-pill` and `epm-duplicates-project-label` no longer exist.
