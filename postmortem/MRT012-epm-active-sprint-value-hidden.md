# Postmortem MRT012: EPM Active Sprint Value Hidden

**Date**: 2026-04-27
**Severity**: High
**Status**: In Progress
**Author**: Codex (GPT-5)

---

## Summary

The EPM Active view preserved the selected sprint in React state and sent it to the rollup API, but the EPM control surface did not render the sprint selector or selected sprint value. The ENG view showed the sprint dropdown; the EPM view showed only EPM tabs and Project. As a result, EPM Active could be scoped by a hidden sprint value, or block on a missing sprint, without giving the user a visible way to inspect or change that value in the EPM context.

The planning miss was not backend logic. The plan verified that the EPM rollup fetch included `sprint: selectedSprint`, but failed to verify that the selected sprint was visible in the EPM UI. Data-path correctness was treated as a substitute for user-facing state visibility.

## Impact

- **Users Affected**: Anyone using the EPM Active view
- **Duration**: Introduced during EPM view extraction and caught by user review on 2026-04-27
- **Symptoms**:
  - EPM Active has no visible sprint dropdown in the main controls
  - EPM Active has no visible selected sprint value in the compact sticky header
  - Rollup requests can still include a sprint, making the UI look unscoped while the data is scoped
  - If no sprint is selected, EPM Active asks the user to select a sprint, but does not render the selector in EPM mode

## Root Cause

The root cause was a planning and verification gap.

### 1. The plan tested request parameters, not visible controls

The EPM extraction plan included guards that checked:

- `fetchEpmProjectRollup(...)` is called through the wrapper
- `tab: epmTab` is passed
- `sprint: selectedSprint` is passed
- Active EPM requires a selected sprint before fetching

Those are necessary but incomplete. They prove the hidden state reaches the API; they do not prove the user can see or change that state.

### 2. The sprint control stayed ENG-only

In `frontend/src/dashboard.jsx`, `renderSprintControl()` exists and shows the selected sprint name. The main and compact header branches render that control only when `selectedView === 'eng'`. The EPM branch renders EPM tabs and the EPM project picker, but not the sprint control.

### 3. Active EPM depends on sprint state but does not own a sprint affordance

EPM Active uses sprint state in two places:

- it blocks rollup fetches when `epmTab === 'active' && !selectedSprint`
- it passes `selectedSprint` to the EPM rollup API

That makes sprint a first-class EPM Active input. Any first-class input must be visible in the same view where it affects results.

### 4. Review confused state preservation with UI truthfulness

The review question should have been: "Can a user tell which sprint scopes this EPM Active board without switching back to ENG?" Instead, the plan answered a narrower question: "Does the EPM fetch keep the sprint parameter?"

## Timeline

- **T+0**: EPM view extraction plan identifies Active EPM rollups as sprint-scoped
- **T+1**: Implementation preserves `selectedSprint` state and request parameters
- **T+2**: Source guards verify request parameter flow and Active sprint gating
- **T+3**: User reports that the current EPM view is missing the sprint value
- **T+4**: Source inspection confirms `renderSprintControl()` is ENG-only while EPM Active depends on `selectedSprint`

## Resolution

Pending implementation. The fix should:

1. Render the existing sprint control in EPM Active mode.
2. Render it in both the main header and compact sticky header.
3. Keep it hidden for EPM tabs that do not use sprint scoping.
4. Add a guard that fails if EPM Active does not render `renderSprintControl('main')` and `renderSprintControl('compact')`.
5. Verify visually that the selected sprint value is visible in EPM Active without switching to ENG.

## Verification

Current verification only proves the diagnosis:

- Source inspection confirms `renderSprintControl()` displays `sprintName`
- Source inspection confirms the ENG branch renders `renderSprintControl('main')` and `renderSprintControl('compact')`
- Source inspection confirms the EPM branch does not render either sprint control
- Source inspection confirms EPM Active still passes `selectedSprint` to the rollup fetch wrapper

## Lessons Learned

### What Went Well

- The source guards caught backend/frontend parameter flow.
- The EPM extraction kept the state owner in `dashboard.jsx`, so the fix can reuse the existing sprint control instead of inventing a new one.
- User review caught the visibility issue before further EPM work built on top of it.

### What Could Be Improved

- Plans must distinguish "state exists" from "state is visible."
- Any scoped view must show the active scope controls in that same view.
- Source guards should assert user-facing control placement, not only API parameters.
- Visual review is required when a change moves or extracts a UI surface.

## Action Items

- [x] Add an implementation plan for EPM Active sprint visibility
- [ ] Add source guards for EPM Active sprint control placement in main and compact headers
- [ ] Render the existing sprint control in EPM Active mode
- [ ] Run `npm run build`
- [ ] Run EPM source guards
- [ ] Visually verify EPM Active shows the selected sprint value
- [x] Add a review checklist item: scoped views must expose the current scope value in-view

## Prevention

To avoid this class of issue:

1. For every request parameter that changes visible results, identify the visible control or label that exposes the current value.
2. Treat hidden state as a bug when it scopes a user-facing view.
3. Add source or UI tests for control placement when extracting view code.
4. Do not mark a UI plan complete based only on fetch wrapper tests.
5. During plan review, ask: "Can the user see every active scope without switching modes?"

## Related Issues

- [MRT011](./MRT011-epm-settings-overgeneralized-selection-ux.md) - another EPM UX miss where implementation reuse overrode the user's actual task

## References

- Files:
  - `frontend/src/dashboard.jsx`
  - `frontend/src/epm/EpmRollupPanel.jsx`
  - `tests/test_epm_view_source_guards.js`
  - `docs/plans/2026-04-27-epm-view-extraction.md`
- Current diagnosis:
  - `renderSprintControl()` is ENG-only in the main and compact header branches
  - `EpmRollupPanel` receives `selectedSprint` but does not display the selected sprint value
