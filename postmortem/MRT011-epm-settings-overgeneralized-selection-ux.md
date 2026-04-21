# Postmortem MRT011: EPM Settings Overgeneralized Selection UX

**Date**: 2026-04-21
**Severity**: High
**Status**: In Progress
**Author**: Codex (GPT-5)

---

## Summary

The EPM settings modal shipped with a control pattern that was technically functional but wrong for the actual decision space. Root goal and sub-goal selection were implemented as persistent search boxes even when the practical choice set was tiny, the modal rendered full project cards instead of compact settings rows, and scope edits were coupled to slow live project fetches instead of an explicit preview flow. The result was a settings screen that was visually hard to read, slow to use, and misleading about whether edits had taken effect.

This was not a one-off styling miss. It followed a repeated agent failure mode: overgeneralizing an existing search/dropdown pattern and reusing a production data-loading path inside a configuration UI without first asking whether that UI needed live behavior at all.

## Impact

- **Users Affected**: Anyone configuring EPM scope or linkage in the settings modal
- **Duration**: Introduced during the EPM goal-picker implementation on 2026-04-21 and caught in manual browser review
- **Symptoms**:
  - EPM settings opened with a visibly overloaded, low-signal layout
  - Root goal and sub-goal search fields stayed visible even after a selection was already made
  - Opening settings triggered slow `GET /api/epm/projects` requests
  - Changing draft scope in settings did not update the visible project list, creating the impression that settings were broken
  - Saving retriggered the heavy project fetch, creating a second wait without clear user benefit

## Root Cause

The failure came from three interacting design mistakes.

### 1. Control-pattern overgeneralization

The implementation reused the repo's existing search/dropdown control pattern because it already existed and matched nearby settings tabs. That was the wrong decision for this case.

The actual EPM scope decision space was not an open-ended search problem. In the reported flow:
- there was already a selected root goal
- there was already a selected sub-goal
- the user usually needed to inspect or change one of a very small number of known options

Persisting an always-visible search box after selection added noise instead of utility. The control exposed the internal mechanism ("search for a value") instead of the actual task ("review the selected scope, then optionally change it").

### 2. Configuration UI reused a production data view

The settings tab rendered EPM projects using a card-like presentation that was close to the main EPM board's metadata presentation. That leaked display-oriented structure into a configuration-oriented context.

A settings screen should optimize for:
- scannability
- compactness
- edit affordance
- clear saved-vs-draft state

Instead, it optimized for:
- preserving rich Home metadata
- link-heavy display cards
- per-project visual blocks that consumed vertical space

This made the form unreadable even before performance problems were considered.

### 3. Draft editing was coupled to the heavy live fetch path

The EPM settings tab loaded the same `/api/epm/projects` endpoint used by the main EPM view. That endpoint performs Atlassian Home discovery and project shaping and is intentionally heavier than a local-form read.

The resulting behavior split responsibility badly:
- opening settings immediately paid the full project-fetch cost
- root/sub-goal edits only changed local draft scope
- the visible project list remained tied to the last persisted fetch
- save then triggered the same heavy fetch again

So the user paid for live behavior twice while still not getting a truthful preview of draft scope changes.

### 4. The agent optimized for implementation reuse instead of UI truthfulness

Across repeated Codex sessions, the same pattern shows up:
- find an adjacent control pattern in the repo
- preserve it aggressively to avoid inconsistency
- keep the mechanism always visible
- wire the visible state to existing backend fetches

That heuristic is fast, but it fails when the current UX needs a narrower interaction model than the reused pattern. In this case it produced a UI that was "consistent with nearby code" while being inconsistent with the user's actual task.

## Timeline

- **T+0**: EPM goal-picker implementation introduces root-goal and sub-goal persistent search controls in the settings modal
- **T+1**: Settings tab is wired to load `GET /api/epm/projects` on open using the same endpoint as the main EPM view
- **T+2**: Manual browser review shows that the settings screen is slow, unreadable, and does not reflect draft scope changes
- **T+3**: User identifies the UX issue explicitly and calls out that the same pattern has appeared in multiple Codex sessions
- **T+4**: Root-cause review confirms this is a repeated agent design failure, not just a missing CSS tweak

## Resolution

Pending implementation. The correct fix direction is:

1. Separate configuration editing from production data fetches
- Opening `Settings -> EPM` should load saved config and lightweight scope metadata only
- Root/sub-goal edits should remain draft-only until an explicit preview/test action or save

2. Replace persistent search-first controls with selection-first controls
- Show the current root/sub-goal selection compactly
- Reveal search only when the user explicitly changes the selection
- Do not leave empty search inputs permanently visible when a value is already selected

3. Replace display cards with compact settings rows
- EPM project linkage should be rendered as compact editable rows, not board-like metadata cards
- Rich metadata can be available on demand, but it should not dominate the configuration form

4. Make preview semantics explicit
- `Test Configuration` should preview the project set for the current draft scope
- `Save` should persist the draft and then refresh the main EPM view once

## Verification

This postmortem documents an issue that is still being corrected, so verification here is about the diagnosis.

- ✅ Manual screenshots show the persistent-search and overloaded-card behavior
- ✅ Browser logs show slow `GET /api/epm/projects` calls during settings use
- ✅ Source inspection confirms the modal opens by clearing and reloading `epmProjects`
- ✅ Source inspection confirms root/sub-goal edits only mutate draft scope, not the visible project preview list

## Lessons Learned

### What Went Well

- Manual browser review caught the issue quickly
- The existence of a separate `Test Configuration` action already hinted at the correct interaction model
- The codebase made the fetch coupling traceable once inspected

### What Could Be Improved

- UI review should have challenged whether a reused control pattern actually fit the number of choices
- Configuration flows should not default to live production fetches without an explicit reason
- "Match existing patterns" was applied too mechanically and overrode task-specific UX judgment
- The implementation optimized for code reuse before validating the user's interaction cost

## Action Items

- [ ] Rework EPM settings so root/sub-goal edits are draft-only until explicit preview/save
- [ ] Replace persistent search boxes with compact selected-state controls that reveal search on change
- [ ] Replace EPM settings project cards with compact linkage rows
- [ ] Add a source/behavior test ensuring opening EPM settings does not immediately fetch `/api/epm/projects`
- [ ] Add a review checklist item: if option count is tiny or already selected, do not default to persistent search UI
- [x] Record the repeated agent failure mode in `AGENTS.md`

## Prevention

To avoid this class of issue:

1. For settings UIs, choose controls from the actual option count and user task, not from the nearest reusable pattern.
2. If a value is already selected, the default state should show the selection, not the search mechanism.
3. Do not couple settings screens to heavy production fetches unless live preview is an explicit requirement.
4. When a screen contains both draft state and persisted state, the UI must make that distinction visible and truthful.
5. During review, ask a concrete question before shipping: "Does this screen help the user review and change a value, or does it expose internal machinery?"

## Related Issues

- [MRT010](./MRT010-startup-api-load-fanout-and-overscoped-payloads.md) - similar heavy-endpoint reuse mistake, but on startup performance rather than settings UX

## References

- Files:
  - `frontend/src/dashboard.jsx`
  - `jira_server.py`
  - `postmortem/README.md`
  - `AGENTS.md`
- Review evidence:
  - `/Users/a.feygin/Desktop/Screenshot 2026-04-21 at 1.55.34 PM.png`
  - `/var/folders/ds/hbvsnc715j5bgy7g7bgbqsdc0000gp/T/TemporaryItems/NSIRD_screencaptureui_EX6RGd/Screenshot 2026-04-21 at 1.56.26 PM.png`
