# Catch Up Project Track Filter Follow-up

Status: executed locally; pending acceptance or merge
Type: feature

## Goal

Add an Epic-owned Project Track facet to the shared Catch Up task-list filter bar and soften the
Status option backgrounds without changing Jira data or adding requests, persistence, mutations,
routes, or analytics events.

The domain contract is defined in `docs/DOMAIN_ONTOLOGY.md`.

## Intended behavior

- Catch Up presents `Project Track` after its existing facets.
- The option vocabulary and emoji are `🔒 Committed` and `🤷 Flexible`.
- Both options remain visible when their count is zero.
- Project Track heading and option counts are unique-Epic counts.
- The task-list readout remains a Story count.
- A selected Project Track admits Stories through their existing parent Epic.
- Both options unchecked admits Stories whose parent Epic has a `null`, missing, or trim-empty
  Project Track.
- A populated unknown Project Track such as `Other` is not unset.
- A Story without a parent Epic is not included in the explicit-empty Project Track state.
- Neutral Project Track admits all Stories, including Stories without a parent Epic and Stories
  under Epics with unknown populated values.
- Explicit-empty state follows the existing Board restoration lifecycle across rerenders, task-list
  modes, Teams changes, and same-scope Department restoration. A new Department or sprint snapshot
  starts neutral.
- Status option labels retain their configured/status vocabulary colors as a softer background tint
  mixed into the filter panel surface. Text remains fully opaque and contrast-readable.

## Architecture

Extract the recognized/unset Project Track classification into one pure shared helper consumed by
both Board and Catch Up. Catch Up receives the already-loaded Epic metadata needed to map each Story
to its parent Epic; it does not fetch or persist anything.

The generic facet engine continues to own explicit-empty selection behavior. Catch Up's storage
adapter must preserve an explicit empty Project Track array instead of converting it to neutral.
Board behavior remains unchanged.

## Files allowed to change

- `docs/DOMAIN_ONTOLOGY.md`
- `docs/features/eng-workflows.md`
- `docs/README_ANALYTICS.md`
- this implementation artifact
- `frontend/src/dashboard.jsx`, without increasing its structure budget
- the existing ENG filter model, visual, view, and shared classification modules needed for the
  relational facet
- corresponding frontend unit/source-guard tests
- corresponding Playwright ENG filter tests
- generated `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and
  `frontend/dist/dashboard.css` through `npm run build` only

No backend file is in scope.

## Forbidden regressions

- Do not reinterpret Project Track as Story-owned.
- Do not classify unknown populated values or Stories without an Epic as `No Project Track`.
- Do not change the Board facet's four-state behavior.
- Do not add a route, fetch, persistence key, Jira mutation, or analytics event.
- Do not dim Status text or lower its contrast together with the background.
- Do not increase `frontend/src/dashboard.jsx`'s structure budget.
- Do not add mobile-specific layout work; the approved existing `+1 more` compaction remains.

## Verification

Use test-first RED/GREEN evidence for:

- shared Project Track classification;
- unique-Epic Catch Up counts with multiple Stories beneath one Epic;
- neutral, Committed-only, Flexible-only, and explicit-empty admission;
- unknown populated and missing-parent exclusions from explicit empty;
- preservation and reset lifecycle;
- softer Status background with readable text;
- zero new analytics or network behavior.

Then run the focused frontend model/source tests, focused Playwright filter tests, production build,
generated-output checks, structure budget, complete frontend unit suite, complete Playwright suite,
and complete Python suite. Stop and report if an unrelated gate fails, matching the parent execution
plan's rule.

## Outcome

Implemented on `feature/issue-150-filter-option-visuals` from the required
`f359ade2cf01233d3694b3e0bc1da8f994254bf0` base. Catch Up now uses the shared
Epic Project Track classifier, counts unique parent Epics in the facet, filters the shared Story
task list through those Epics, and preserves the explicit-empty state across mode and Teams
changes. Board continues to use the same fixed vocabulary and four-state contract. Status labels
use surface-mixed backgrounds with fully opaque, contrast-readable text.

Verification on 2026-09-04:

- focused model/source tests: 153 passed;
- complete frontend unit suite: 1,163 passed;
- focused ENG Playwright: 45 passed;
- complete Playwright suite: 665 passed, 2 skipped;
- complete Python suite: 1,538 passed, 9 skipped;
- `frontend/src/dashboard.jsx`: 17,493 lines, with the existing structure budget unchanged;
- two consecutive Node 20 builds produced identical hashes;
- startup preflight passed with migrations at head;
- isolated browser checks used the authorized local service without accessing a personal browser.

## Current Accuracy

Accurate for the locally implemented, verified follow-up. No push, PR, merge, or issue closure has
been performed.
