> **Status:** Done (Option B). Executed on `improvement/319-epm-design-system-pills`. Kept for audit context only.


# EPM view: use the app font for project name and update text (#319 follow-up)

Visual reference: [`assets/mockups/epm-fonts-319.html`](../../assets/mockups/epm-fonts-319.html) (compiled `dashboard.css`, real markup, synthetic data, rich-text update with heading, list, link and table).

## Audit (2026-10-29)

The system sans stack `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` is declared in exactly three rules, all in `frontend/src/styles/epm/project-board.css`: `.epm-project-board-name` (0.95rem / 650), `.epm-project-board-update` (0.9rem, including its rich-text children) and `.epm-project-board-owner-avatar` (0.55rem / 700). The only other match in the stylesheets is an `@supports` probe in `eng/epics.css`. Everywhere else titles and body text use the app font (Crimson Pro, inherited from `body`) and metadata uses IBM Plex Mono. The stack is in the grandfathered font-family list of `tests/design_system_baseline.json`, so no ratchet flags it; this is a consistency fix, not a rule violation. No other EPM family, and no EPM size outside the grandfathered scale, was found.

## Options

- **A, family only:** the three rules get `font-family: inherit`; sizes unchanged. In the mockup the serif reads smaller and the 72ch update card narrows with it.
- **B, family and size matched to ENG (recommended):** as A, plus `.epm-project-board-name` at 1.1rem / 600 (the ENG `.epic-name` values) and `.epm-project-board-update` at 1rem; update headings (`h1`-`h2` 1rem, `h3`-`h6` 0.9rem) and the table font stay as they are unless the mockup shows them out of balance. Both sizes are already in the grandfathered scale.

Rejected: leaving the stack, since EPM would remain the only surface not using the app font.

## Scope

In: the three rules above and the tests and docs that name them. Out: IBM Plex Mono metadata, the missing 600/700 mono weights (separate cleanup, the page loads only Plex Mono 400/500), the 0.5rem micro text, any layout change. No data, endpoint, write path or analytics change (visual only).

## Tasks

1. **Guard first.** Add a source guard in `tests/test_epm_view_source_guards.js` that `project-board.css` contains no `-apple-system` and that the name and update rules do not set a font-family other than `inherit`; confirm it fails before the CSS change.
2. **CSS.** In `project-board.css` replace the three font-family declarations with `inherit` (or delete them where the parent already supplies the app font; the name's own `h3` rules must keep `letter-spacing: 0; text-transform: none`). Option B also sets the two sizes. Keep `.epm-project-board-update`'s `max-width: 72ch` and re-check the update-card width.
3. **Playwright.** In `tests/ui/epm_portfolio_header_visual.spec.js` assert on the mounted fixtures: name, update copy and avatar computed `font-family` equal the page body's; (Option B) name 1.1rem / 600 and update 1rem; rich-text headings, list, link, bold and table inherit the same family; no horizontal overflow of `.epm-project-board-title-row` at 1520px and 390px with a 60-character project name; the name stays within the title grid (ellipsis or wrap as today).
4. **Docs.** `docs/design-system.md`: record that EPM uses the app font in the Status/typography notes only if a typography section exists; otherwise one sentence in `docs/features/epm-view.md`. Regenerate `tests/design_system_baseline.json` only if the generator reports a change (the family list may shrink if no rule uses the stack any more; shrinking is allowed, additions are rejected).
5. **Verification.** `npm run build`; touched specs and node guards; then the full Python, frontend unit and Chromium UI suites at the final head (`dashboard_data_freshness.spec.js` EPM tests are known flaky, compare against the stashed baseline if they fail). Screenshots before and after at desktop and 390px, compared with the mockup option chosen; verify Firefox and WebKit headed for the avatar initials and name glyph metrics (font fallback differs by engine).

## Acceptance

- No `-apple-system` stack remains in `frontend/src/styles`; EPM project name, update text and avatar render in the app font.
- Rich-text updates (heading, list, link, bold, table) render legibly in the app font at desktop and 390px with no overflow.
- Baseline does not grow; no new class, font-family value or size.
- Full suites pass at the proposed head, apart from documented flakes.

## Risks

- Crimson Pro has a smaller x-height than the system sans, so Option A looks smaller; B compensates and the mockup is the check.
- Home rich-text can contain content that relied on sans metrics (wide tables); the table already scrolls inside `.adf-table-scroll`.
- Avatar initials at 0.55rem in a serif can look thin; if it does, keep the avatar on the mono stack instead of widening the scope (decide from the headed screenshots).

## Outcome (2026-10-29)

Option B implemented: `.epm-project-board-name` is 1.1rem / 600 and `.epm-project-board-update` 1rem, both with `font-family: inherit`; the system sans stack no longer appears in any stylesheet and the baseline font-family list dropped it (7 to 6 values). The owner avatar's `inherit` resolves to the owner row's IBM Plex Mono (not the serif body), so initials moved from the system sans to the app's mono; this was accepted as the preferred outcome of the plan's avatar risk note and is asserted against the owner row. `tests/test_dashboard_css_extraction.py` pinned the old 0.9rem and was updated.

Verification: guard test failed on the old CSS and passes on the new; the Playwright font spec passes 8/8 on Chromium, Firefox and WebKit (headless); frontend unit 3171/0; Python failures limited to the known load-flaky `test_local_postgresql_runner` SIGINT cases plus the pinned-size test fixed above; Chromium `tests/ui` 1997 passed with the known EPM freshness timing specs and one share-control spec failing under load (the share spec passes alone). Headed Firefox/WebKit glyph checks were not run.

## Current accuracy

Describes current behaviour.
