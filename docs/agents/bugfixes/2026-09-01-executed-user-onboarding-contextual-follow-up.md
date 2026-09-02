# User Onboarding Contextual Follow-up Design

Status: executed
Type: bugfix

## Outcome sought

Correct the desktop onboarding regressions found during manual verification and extend the tour with contextual Configuration, Planning, Board, and Statistics guidance. Keep the completed first-run Department flow, field-preview mutation guards, desktop accessibility model, and generated-build workflow intact.

## Approved decisions

1. Use contextual modules rather than one forced linear tour. While onboarding is active, clicking the real Settings, Planning, Board, or Statistics launcher opens that area normally and then starts its incomplete module.
2. Keep **Next** visible on every non-terminal step. For an interactive Jira-field preview, **Next** is disabled until the user clicks the exact highlighted control and closes its preview. Closing the preview never advances automatically.
3. Replace the interactive instruction with: **Click the highlighted control to preview its choices. Nothing will change.**
4. Widen the desktop coachmark to approximately 560 CSS pixels within viewport bounds. Use the existing In Progress blue for **Next**, blocked red for both Skip actions, and the existing neutral treatment for **Back**. Use distinct filled and outlined red treatments so **Skip onboarding** and **Skip this section** remain distinguishable.
5. Make the small star in the left Department row the only favorite control. Remove the large right-pane star and target first-run favorite guidance at the row-star slot.
6. Move **Show in Department selector** out of the editor heading into its own compact preference row. When the active Department is the favorite, show only the short note **Favorite Departments are always shown.** Place **Duplicate** below the preference row with ordinary spacing.
7. Keep mobile dashboard onboarding deferred. Preserve already completed mobile preparation without expanding the tour to mobile.

## Contextual module model

The onboarding controller owns one desktop session containing required module ids and session-only completion state. The existing persisted `onboarding_done` boolean remains the only backend preference: it becomes true only when every required module is complete or the user explicitly skips onboarding.

The required modules are:

- **Catch Up**: the existing dashboard basics, hierarchy, Jira-field preview, and Jira handoff content.
- **Configuration**: entered by clicking the real Settings gear; opens Departments → Team Groups for the active Department and points to the real Team search/add control.
- **Planning**: entered by clicking the real Planning segmented-control option; explains the planning selection/action area after Planning renders.
- **Board**: entered by clicking the real Board option; explains the group board after it renders.
- **Statistics**: entered by clicking the real Statistics option; explains the statistics surface after it renders.

The Catch Up overview adds launcher steps for Settings, Planning, Board, and Statistics. Each launcher remains a real reachable control. A pointer click or its native keyboard activation switches the application state through the existing handler; onboarding observes the resulting surface and starts the corresponding incomplete module. It does not synthesize clicks or programmatically force a view change.

Reopening a completed module during the same session does not interrupt the user. Reopening an incomplete module resumes it. Disabled, unavailable, loading, empty, replaced, or failed launch targets use an honest field-specific fallback with manual **Next**; onboarding never claims that a disabled area was opened.

Configuration guidance explains how to add a Team but never requires a configuration mutation when the active Department is already valid. If the user edits Settings, the existing dirty, Save, Cancel, conflict, saving, and authentication contracts remain authoritative. The guide pauses while a save/discard decision or request is pending and never saves automatically.

## Interactive preview state

Each `menu-preview` step has a session-scoped completion latch keyed by the tour session and step id:

- Initial state: **Next** visible and disabled.
- Exact target opens and reaches `ready` or `empty`: record that the highlighted preview was genuinely reached.
- Preview closes through the same trigger or Escape: restore target focus and enable **Next** once.
- Preview error: restore the existing field-specific fallback and enable manual **Next** after the failed preview closes.
- Target loss, cleanup, unmount, stale descriptor, or unrelated close: do not unlock or advance.
- Re-render, remount, duplicate close, duplicate click, or stale listener: cannot unlock another step or advance twice.

The preview remains read-only and retains the negative Jira mutation guards. Pointer and keyboard paths must both use the exact highlighted control. No Playwright force-click is valid evidence.

## Coachmark and Settings presentation

Desktop coachmarks use a stable action layout rather than wrapping four visually equivalent controls unpredictably. At normal desktop widths the footer keeps the full-tour Skip separate from Back, section Skip, and Next/Finish. A narrow non-mobile fallback may use two deterministic rows without overlapping or clipping actions.

The left Department row owns the favorite star in all modes. In ordinary Settings it remains a native `aria-pressed` button. During first-run pending-save guidance, the same slot becomes a compact non-operable pending status with an accessible name; it must not become a large disabled button or a no-op interactive target.

The right editor heading contains only the Department title. The visibility checkbox and concise helper occupy a separate preference row, followed by **Duplicate**. This prevents the flex-wrap regression that scattered the heading, star, checkbox, and long helper across the pane.

## Accessibility and restoration

- Interactive steps retain the target-reachable coachmark model and exact restoration of pre-existing `inert`, `aria-hidden`, `aria-disabled`, and `aria-describedby` state.
- Manual and fallback steps retain modal isolation.
- Contextual module transitions wait for the destination target to render, then focus or describe the real target without hiding its owned portal.
- Focus returns to the launcher or exact preview target as appropriate.
- Native Enter/Space activation is supported wherever the underlying control supports it; Escape closes an open preview before affecting onboarding.
- Authentication lock aborts onboarding UI and defers to the global recovery screen.
- The Settings replay action remains header-wide and disabled while any Settings section is dirty or saving.

## Analytics and data boundaries

No backend route, database schema, persistence shape, or new analytics event is required. Reuse existing safe launcher/view-selection events and existing options-open events. Do not add step ids, Department ids/names, team values, search text, issue keys, or other raw content to analytics.

The contextual modules do not mutate Jira. Configuration writes occur only through explicit existing Settings actions. `onboarding_done` retains its current user/workspace ownership and skip/finish route.

## Verification contract

Use repository-pinned Node 20 and test-driven development for every slice. Required proof includes:

- focused unit tests for module state, launcher transitions, preview unlock guards, and step catalogs;
- Playwright normal-click and keyboard activation for Settings, Planning, Board, Statistics, and all three field previews;
- disabled Next before preview close and enabled Next after a valid ready/empty/error close, with no auto-advance;
- duplicate-event, rerender, remount, stale-listener, target-loss, and auth-lock guards;
- zero Jira mutation during Priority, Project Track, and Status previews;
- exact portal, focus, inert, and ARIA restoration;
- visual screenshots of the widened coachmark action hierarchy and corrected Team Groups editor header/preference layout;
- complete Python, frontend unit, and Playwright suites;
- a fresh authorized Node 20 build verification checkout for reproducible `frontend/dist`, never a hand edit;
- `git diff --check` and a line-by-line final diff review.

## Forbidden regressions

- Do not reintroduce root-wide modal isolation for interactive steps.
- Do not auto-advance a field-preview step when its menu closes.
- Do not create a second favorite control or make visibility the favorite mechanism.
- Do not require a Team mutation to complete contextual Configuration guidance.
- Do not synthesize application navigation or bypass disabled controls.
- Do not expand mobile dashboard onboarding in this work.
- Do not change backend ownership, endpoint, CSRF, authentication, Jira write, or analytics schemas.
- Do not read or modify the explicitly excluded Home Project Write Capability gate during this follow-up.

## Current accuracy

Partially superseded by the 2026-09-02 screen-scoped follow-up. Contextual modules, the single favorite control, accessibility restoration, analytics, and no-mutation contracts remain current. The locked-Next and launcher-sequence decisions above are historical: Next now stays enabled on every step; Next or the highlighted field opens a read-only field preview; a preview choice/surface, the same field, or Next then advances exactly once; Escape closes without advancing. Catch Up never asks the user to activate Settings or another tool, and its final controls return to the real page header in this order: Switch tools, Search, Open in Jira, Refresh data, Settings, then Tour complete. `docs/features/onboarding.md` is the canonical current behavior.

## Outcome

The desktop follow-up and its final whole-branch review fixes were implemented and verified at `02f75e1`; the verification totals below remain historical evidence for that execution. Its locked-Next preview progression and Catch Up launcher sequence were superseded on 2026-09-02 by the current screen-scoped, always-enabled Next interaction described above. The coachmark action hierarchy and Department Settings single-favorite/compact-visibility layout remain current.
