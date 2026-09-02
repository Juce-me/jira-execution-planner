# Configuration Favorite Heart UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. This repository forbids worktrees unless the user explicitly requests one, so execute in the active checkout.

Status: executed
Type: bugfix

**Goal:** Remove the duplicate right-pane Department heading and replace the ambiguous star with a clear orange/gray heart control.

**Architecture:** Keep the existing favorite state, persistence callbacks, accessibility contract, and list-row ownership. Change only the rendered glyphs and narrowly scoped Settings CSS so the control cannot inherit the global dark button hover.

**Tech Stack:** React 19 JSX, CSS, Playwright, esbuild

## Outcome

Implemented as planned. The right-pane duplicate heading is removed, favorite state uses orange/gray hearts, and the scoped hover/focus treatment prevents the global dark button surface without changing favorite behavior.

## Scope

- Remove the direct `.group-editor-header` child and its repeated `.group-editor-name` heading from the Department group editor.
- Keep the left-list favorite as the only favorite control.
- Render a selected favorite as an orange filled heart (`♥`).
- Render an unselected favorite as a gray outline heart (`♡`).
- Preserve the existing 44×44 target, native button, `aria-pressed`, accessible names, disabled behavior for groups without teams, click isolation, and first-run status target.
- Override inherited global button hover styling with a subtle pale-orange surface and no dark background, translation, or shadow.
- Keep the first-run pending-favorite status orange and non-operable, using the filled heart.

## Forbidden Regressions

- Do not add a second favorite control to the right pane.
- Do not change personal favorite storage, save ordering, visibility rules, analytics, or dashboard scope behavior.
- Do not shrink the favorite target below 44×44 or replace the native ordinary-state button.
- Do not alter unrelated group editor controls or the existing active-row border treatment.

## Files Allowed To Change

- `frontend/src/settings/TeamGroupsSettings.jsx`
- `frontend/src/styles/settings/group-editor.css`
- `frontend/src/styles/settings/team-selector.css`
- `tests/ui/shared_department_groups.spec.js`
- `tests/test_first_run_group_configuration.js`
- `tests/test_epm_settings_source_guards.js`
- Generated `frontend/dist/` files produced by `npm run build`
- This work artifact, only to record execution outcome and accuracy

## Acceptance Criteria

1. `.group-editor` has no direct `.group-editor-header` child and does not repeat the active Department name above the right-pane controls.
2. Ordinary favorite controls use `♥` when pressed and `♡` when unpressed.
3. Selected and pending favorite hearts are orange; unselected hearts are gray.
4. Hovering or keyboard-focusing an enabled heart never produces the global dark button surface, lift, or shadow.
5. Existing favorite accessibility, disabled-state, first-run guide, save, and visibility behavior remains intact.
6. Focused Playwright coverage passes, the frontend build succeeds, and settled desktop screenshots confirm the editor and both heart states.

## Current Accuracy

Accurate as executed on `feature/user-onboarding-tour`. The implementation and regression coverage match this artifact.

## Execution Tasks

### Task 1: Add UI regression coverage

**Files:**

- Modify: `tests/ui/shared_department_groups.spec.js`
- Modify: `tests/test_first_run_group_configuration.js`
- Modify: `tests/test_epm_settings_source_guards.js`

- [x] Replace assertions that require `.group-editor-header` with assertions that the direct header is absent and `.group-preference-row` is followed by `.group-editor-actions`.
- [x] Assert the first-run pending favorite contains `♥`.
- [x] Assert ordinary pressed and unpressed controls contain `♥` and `♡` respectively.
- [x] Hover an enabled unpressed heart and assert its computed background is not the global dark `rgb(47, 47, 47)`, its transform is `none`, and its shadow is `none`.
- [x] Run `npx playwright test tests/ui/shared_department_groups.spec.js --grep "first-run preferences favorite|personal favorite star"` and confirm the new assertions fail because the production UI still renders stars, the duplicate header, and global hover styling.

### Task 2: Implement the minimal UI and style changes

**Files:**

- Modify: `frontend/src/settings/TeamGroupsSettings.jsx`
- Modify: `frontend/src/styles/settings/group-editor.css`
- Modify: `frontend/src/styles/settings/team-selector.css`

- [x] Remove the direct `.group-editor-header` and `.group-editor-name` markup.
- [x] Render `♥` for selected and pending favorites and `♡` for unselected favorites.
- [x] Give `.group-list-star` an explicit gray default color, centered no-margin geometry, and a scoped hover/focus-visible override with a pale-orange background, orange foreground, no transform, and no shadow.
- [x] Give pressed and pending favorite states the existing orange accent color.
- [x] Remove now-unused `.group-editor-header` and `.group-editor-name` rules.
- [x] Re-run the focused Playwright command and confirm both scenarios pass.

### Task 3: Rebuild and verify

**Files:**

- Regenerate: `frontend/dist/dashboard.js`
- Regenerate: `frontend/dist/dashboard.js.map`
- Update: this artifact to `executed` with the actual outcome

- [x] Run `npm run build` and confirm exit code 0.
- [x] Re-run the focused Playwright command against the built output.
- [x] Inspect settled desktop screenshots for selected/unselected hearts, hover treatment, and the right editor without the duplicate heading.
- [x] Run `npm run test:frontend:unit`; all 1,044 tests pass.
- [x] Review `git diff --check`, the scoped diff, and worktree status; preserve the existing unrelated `.env.example` change.
