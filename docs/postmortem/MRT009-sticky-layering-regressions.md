# Postmortem MRT009: Sticky Layering Regressions

**Date**: 2026-02-06  
**Severity**: High  
**Status**: Resolved  
**Author**: Codex

## Summary
Sticky UI elements (search header, planning panel, epic header, scenario axis) intermittently overlapped, obscured content, or appeared in the wrong order after a series of header/sticky layout changes. This broke scanning and navigation during scroll, especially in Planning mode.

## Impact
- Users saw planning content cover epic headers and task rows.
- Sticky search or header elements could cover critical labels.
- The experience differed by viewport height and mode (Catch Up vs Planning).
- Duration: multiple iterations during UI refactors (header compaction + sticky updates).

## Root Cause
Sticky elements were introduced/modified without a single, shared offset system:
- Multiple sticky elements used independent `top` values, some tied to header spacing and some to element heights, causing overlap when layouts changed.
- Sticky search experiments added high `z-index` values and a sticky container, which conflicted with existing sticky layering.
- Planning panel height and margins changed during compaction, but `top` offsets for the epic header were not consistently recalculated.
- No automated checks or manual checklist enforced “stacking order” invariants across modes.

## Timeline
- 2026-02-01 to 2026-02-05: Header compaction and sticky experiments introduced.
- 2026-02-05: Search temporarily made sticky; z-index conflicts began.
- 2026-02-05 to 2026-02-06: Planning panel height changes and epic header offset drift caused overlap.
- 2026-02-06: Sticky stacking restored using explicit ordering and offset conventions; search reverted to non-sticky.

## Resolution
- Re-established sticky ordering and explicit offsets:
  - Planning panel on top when open.
  - Epic header directly below planning panel.
  - Scenario axis below epic header when visible.
- Reverted sticky search (kept in header actions row).
- Updated AGENTS sticky layering guidance and validated in Catch Up, Planning, Scenario modes.

## Verification
- Manual verification in Catch Up and Planning modes:
  - Planning panel sticks to top and never overlays epic header.
  - Epic header sticks immediately below planning panel when open.
  - Scenario axis sticks below epic header when visible.
  - No overlap between sticky elements during scroll at multiple viewport heights.

## Lessons Learned
- Sticky UI needs a single shared offset model; “local” offsets drift quickly during layout changes.
- Any header compaction or spacing change must explicitly revalidate all sticky layers.
- Visual regressions are easy to miss without a checklist or test harness.

## Action Items
- [x] Document sticky order and validation requirements in `AGENTS.md`.
- [ ] Centralize sticky offsets into CSS variables (single source of truth).
- [ ] Add a lightweight UI checklist to PR templates for sticky changes.
- [ ] Add basic UI regression screenshots for Catch Up and Planning modes.

## Prevention
- Use a shared CSS variable for `--sticky-top` and derive all sticky `top` values from it.
- Require a “sticky stack” verification step in any header/layout PR.

## Related Issues
- MRT007: Bundled Frontend Regression (indirectly affected by layout changes)

## References
- `jira-dashboard.html` (sticky CSS, z-index, offsets)
- `frontend/src/dashboard.jsx` (planning panel open state)
- `AGENTS.md` sticky layering section
