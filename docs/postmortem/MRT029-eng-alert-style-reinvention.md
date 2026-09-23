# Postmortem MRT029: ENG Alert Row Reinvented Existing Styles

**Date**: 2026-09-16
**Severity**: High
**Status**: Resolved

## Summary

The Stories Required alert introduced a new row composition and allowed a semantic button to inherit
the application's global button surface. The result no longer resembled the established ENG alert
rows: the title became uppercase monospace text on a dark hover block, and a new orange
`Open epic in Jira` action changed the row layout. The same implementation also displayed Team UUIDs
and could not reveal a filtered hierarchy target when clicked. The requested feature was a new alert
category, not a redesign of existing alert presentation, and the delivered interaction was not
functional under the normal default filter state.

The regression repeated the style-reuse failures documented in MRT020 and MRT021. The implementation
had an existing `.alert-story` pattern available, but treated the new interaction as permission to
invent a new visual treatment. The local navigation behavior remains useful; its presentation and
row composition were wrong.

## Impact

- Stories Required looked unrelated to the other alert categories in the same panel.
- Hovering the alert title produced a large dark surface, uppercase text, and tracking not present in
  the reference design.
- The added Jira action displaced the established title, note, and dismiss composition.
- Team group headers exposed internal UUIDs instead of the configured display names.
- With Killed work present in scope, clicking an alert left the user at the alert because the target
  ghost remained filtered out.
- The user had to provide a direct before/after comparison and request another correction.
- Confidence was reduced because the branch had already required corrections for alert data-source
  and existing-control regressions.

The evidence establishes a local branch regression. It does not establish a production deployment,
a count of affected users, or any Jira data mutation.

## Root Cause

### 1. Existing alert composition was not treated as the design contract

The established row already defined the appropriate structure: title, explanatory note, and dismiss
control. The implementation instead added a separate external Jira action. That was not required for
local alert-to-ghost navigation and made the new category visually and behaviorally exceptional.

### 2. Semantic markup was added without fully neutralizing global presentation

Changing the title interaction to a native `button` was correct for local navigation, but the global
button rules apply dark backgrounds, uppercase monospace text, letter spacing, margins, hover lift,
and shadow. The first local reset did not override all of those properties, including the hover rule.
The browser therefore rendered global control styling inside an existing link-like alert title slot.

### 3. Tests protected behavior but not reuse of the established visual system

The initial browser test asserted button semantics, the new external link, and navigation behavior.
It did not compare computed presentation with the adjacent alert note or prohibit the extra row
action. The test consequently enforced an invented composition instead of detecting it.

### 4. Visual review did not use the existing alert as the source of truth

The feature design screenshot was reviewed as a target for the new hierarchy ghost, but the alert
row was not compared against the already implemented alert pattern before completion. Related
postmortems had already identified this failure mode, yet their lessons were not converted into an
explicit reuse check for this surface.

### 5. The Team-catalog storage envelope was normalized at the wrong boundary

Both local and DB-backed catalog loaders return `{catalog, meta}`. The readiness helper passed that
whole envelope to a normalizer that accepts a flat Team-id map. It normalized to an empty map, and
the projection fell back to each Team id as its display name. Route tests mocked the helper after
normalization, so they never exercised the real loader contract.

### 6. Alert navigation reset to a still-active default filter

The normal Catch Up default hides Killed Stories. When Killed work exists, that default is a
non-neutral Status facet, and Story requirements are deliberately suppressed under narrowed Story
facets. The alert navigation callback reused ordinary Clear All behavior, restoring the same
`Killed hidden` state. Its double-frame retry therefore searched for a target that still could not
render. Existing browser coverage used a scope without a Killed Story, so the target was already
visible before activation and never tested the reveal path.

## Timeline

1. The Stories Required category was implemented with a local-navigation button and an additional
   external Jira action.
2. A partial button reset was added, but global hover and typography rules still won.
3. Automated checks passed because they asserted the new behavior and destination, not the existing
   row's computed styling or composition.
4. The user supplied two screenshots: the current dark, uppercase row and the established alert style
   that should have been reused.
5. A focused Playwright assertion was added first and failed because the extra `.alert-action` still
   existed.
6. The row was corrected by removing that action and fully neutralizing global button presentation
   within the alert title slot.
7. Live verification then exposed UUID Team labels and an alert click that left the target absent.
8. Red tests reproduced the catalog-envelope mismatch and the default-filter navigation failure;
   the loader boundary and dedicated reveal reset were corrected.

## Resolution

- Retained the native local-navigation button and its alert-to-ghost behavior.
- Restored the existing title, note, and dismiss-only row composition.
- Removed the redundant alert-row Jira action; the hierarchy ghost remains the explicit Jira link.
- Scoped the style reset to `button.alert-story-local-link` and explicitly reset background, border,
  margin, radius, typography transformation/tracking, transform, and shadow in normal and hover
  states.
- Added browser assertions for composition and computed hover styling, while preserving navigation,
  focus, and highlight checks.
- Unwrapped the persisted Team-catalog envelope before normalizing its inner catalog.
- Made alert-to-ghost navigation clear Status, Priority, Project Track, project, search, and focused
  stats filters to a truly neutral reveal state rather than restoring the normal Killed exclusion.
- Extended the browser fixture with both open and Killed work so the target is absent before the
  click and must render, scroll, focus, and highlight after activation.
- Updated the design, execution plan, feature documentation, analytics allowlist, and project
  operating rule to reflect the reused design contract.

## Verification

The focused Playwright test was run red before the fix and failed on the unexpected secondary alert
action. After the correction it passed and verified:

- the title remains a native button;
- no secondary `.alert-action` exists;
- hover remains transparent with no shadow or transform;
- text is not uppercased or letter-spaced;
- the button uses the same font family as the existing note;
- activation still reveals, focuses, and highlights the exact local requirement without changing the
  browser URL.
- a persisted Team-catalog envelope resolves the configured Team name instead of its UUID.

The production frontend bundle was rebuilt successfully. Focused frontend, backend, and visual
checks are recorded with the implementation handoff. The live DB/OAuth dashboard then showed named
Teams, rendered 37 requirement targets after reveal, and focused/highlighted the clicked Epic at the
new scroll position.

## Lessons Learned

- Adding a new category to an established component does not authorize a new component language.
- Native semantics and visual reuse are separate obligations; a correct element can still inherit the
  wrong global surface.
- A regression test must encode the existing design contract, not merely the new interaction.
- Additional actions are product and layout changes even when they appear helpful.
- A reference screenshot is useful only when the implementation is directly compared against it.

## Prevention

- New ENG alert categories must reuse the existing `.alert-story` title, note, and dismiss
  composition unless the user explicitly requests a redesign.
- Link-like buttons inside shared surfaces must have normal, hover, focus, and active presentation
  checked against global button selectors.
- Browser tests for new alert categories must prohibit unrequested secondary actions and assert the
  relevant computed styles under hover.
- Team-catalog consumers must test the persisted `{catalog, meta}` loader contract, not only a
  pre-normalized flat map.
- Alert navigation tests must begin with the target hidden by each supported filter reset path and
  prove that activation makes the exact composite target visible and focused.
- UI review must identify the existing in-product component serving the same role and use it as the
  visual source of truth before accepting a new variant.

## Action Items

| State | Action | Completion evidence |
|---|---|---|
| Done | Remove the secondary Jira action and restore the established alert composition | `EngAlertsPanel.jsx` and focused Playwright assertion |
| Done | Neutralize global button presentation in normal and hover states | `alerts.css` computed-style assertions |
| Done | Keep local reveal/focus/highlight behavior intact | Focused alert-to-ghost browser test |
| Done | Resolve Team display names from the persisted catalog envelope | Backend envelope regression and live DB/OAuth verification |
| Done | Clear the default Killed exclusion for an explicit reveal action | Browser fixture with open and Killed work |
| Done | Align design, plan, feature, and analytics documentation | Updated feature documents and analytics allowlist |
| Done | Add a concrete project rule requiring existing ENG alert styles | Root `AGENTS.md` learning |
| Done | Review MRT020, MRT021, and MRT028 before completing the correction | Related postmortem review recorded in this incident |

## References

- [MRT020: Project Track filter bar reinvented existing controls](MRT020-project-track-filter-bar-bespoke-controls.md)
- [MRT021: Project Track segmented controls overridden instead of reused](MRT021-project-track-segmented-control-override.md)
- [MRT028: Epic header regression and instruction drift](MRT028-epic-header-instruction-drift.md)
- [ENG alerts implementation](../../frontend/src/eng/EngAlertsPanel.jsx)
- [ENG alert styles](../../frontend/src/styles/eng/alerts.css)
- [Stories Required browser regression](../../tests/ui/eng_missing_story_ghosts.spec.js)
- [Stories Required design record](../agents/features/2026-09-16-executed-eng-story-readiness-ghosts-design.md)
- User-provided before/after screenshots from 2026-09-16; screenshots containing live issue data are
  not copied into repository documentation.
