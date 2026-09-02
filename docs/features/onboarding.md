# User Onboarding

In authenticated workspace-database mode, first run has four phases:

1. Choose an eligible existing Department, or choose **Add Department** to create, duplicate, or repair one.
2. Configure the draft in the real Settings → Departments → Team Groups editor.
3. Complete a verified **Save and continue**.
4. Start the onboarding module for the screen the user is currently using, when that module is still incomplete and the dashboard is on a desktop-sized viewport.

The configuration guide and dashboard tour never run together. Completed users are not replayed automatically. See [ENG Workflows](eng-workflows.md) for the full operational behavior and Jira discovery rules.

## Phase 1: choose or add a Department

First-time users must select one Department with at least one configured Team. This is the **Mandatory Department selection**: choosing an eligible existing Department is explicit, followed by **Continue**, and the stage has no Skip action.

**Add Department** opens the choice between a clean Department and a source-explicit duplicate. An existing Department without Teams offers **Configure and use {Department}** instead. Create, duplicate, and repair prepare the edited Department as the user's pending favorite and visible Department, then open the Team Groups editor; they do not write preferences while the user is still choosing.

JSON, file, and environment configuration modes keep their shared-default behavior. Those modes and Basic-auth mode do not automatically run or replay the tour and do not write onboarding state. The personal selection and tour flow is available only with Atlassian OAuth and workspace-database Department configuration.

## Phase 2: guided configuration

The guide points at the real Settings controls for Department name, Teams, optional Components, favorite, and visibility. The Department name is edited only in the left list; compact and mobile layouts expose it through the **Groups** drawer. At least one Team is required. Components can be skipped with **Continue without components**.

Cancelling before any shared save restores the captured Settings draft and returns to the chooser. Once a shared section has been saved, the guide stays in recovery so committed shared work is not presented as cancelled or rolled back.

## Phase 3: verified save

**Save and continue** saves shared Department configuration first, then private preferences. The private preference stores the one favorite Department and the visible Department set for the signed-in user; it never changes the workspace's shared default.

Each successful shared save is verified against the returned workspace configuration. If a later shared section fails, retry continues with only the work that remains. If shared Department configuration succeeds but the private preference fails, the shared change remains saved and the user receives a preference-only retry. The dashboard does not load Department-scoped data until the verified personal selection succeeds.

## Phase 4: screen-scoped onboarding

Onboarding has five independent modules: Catch Up, Configuration, Planning, Board, and Statistics. Catch Up starts automatically only when Catch Up is the current screen. Configuration starts on the first real Settings open; Planning, Board, and Statistics start after the user selects each tool through the normal ENG mode control. Scenario has no onboarding module. Completing one module never launches or navigates to another.

Catch Up covers its dashboard controls, hierarchy, Jira handoff, and read-only Priority, Project Track, and Status menu previews. After the field previews, its final header-control sequence is **Switch tools**, **Search**, **Open in Jira**, **Refresh data**, **Settings**, then **Tour complete**. These steps return the page to the header controls, point out that Settings can add or manage Departments, do not click Settings, do not select another tool, and do not programmatically navigate to another surface. **Next** remains enabled throughout onboarding. On a field-preview step, clicking **Next** or the highlighted field opens the preview; once it is open, clicking a preview choice, the preview surface, the same field again, or **Next** closes it and advances exactly once. Escape closes the preview without advancing. No preview chooses a value or mutates Jira. Missing or unavailable targets are omitted or use explanatory fallback steps only where the catalog defines one, so no coachmark points at an absent control.

Each module persists independently across logins. **Finish**, **Skip onboarding**, and Escape complete only the active module after the server confirms the canonical completed-module list. A failed write keeps that module open with a retryable error; an expired session uses the app-wide sign-in recovery. Closing or leaving a module before completion writes nothing, and that module restarts at its first step on its next real open. A stale completion from an older screen may update the canonical completed list, but it cannot close a newer screen's tour. The legacy `onboardingDone` value is derived as true only when all five modules are complete.

Configuration points to the real Department Team editor. It never adds, removes, or saves a Team automatically. The other modules likewise never change the active sprint, Department scope, Teams, favorite, Priority, Project Track, Jira Status, or selected tool except through the user's own normal interaction.

Screen-scoped onboarding is desktop only. At viewport widths of 760px or less it stays closed, while the first-run Department chooser, configuration, and ordinary Settings routing continue to work. An incomplete module remains eligible and starts at its first step when that screen is next opened at desktop width. Mobile dashboard-tour work is deferred in GitHub issue #151.

Existing boolean preferences migrate without replaying completed users: legacy `onboardingDone: true` becomes all five modules complete, while legacy `onboardingDone: false` becomes no modules complete.

## Replay from Settings

In Atlassian OAuth workspace-database mode, **Run onboarding again** remains at the right of the Settings header across tabs. It is disabled while any Settings section is dirty or saving. Starting replay resets all five completed modules. Only after that reset succeeds does Settings close, ENG Catch Up become active, and the Catch Up module start on desktop. A failed write keeps Settings open and leaves the previous state unchanged.

On a mobile-width dashboard, choosing **Run onboarding again** still resets all modules, closes Settings, and returns to Catch Up, but no tour is shown. Catch Up begins at its first eligible step when the dashboard is next opened at desktop width. Mobile dashboard-tour work remains deferred in GitHub issue #151.

Replay does not alter Department visibility, the saved favorite, dashboard scope, sprint, or Team selection. Users who have already completed onboarding are not replayed automatically.

## Analytics and privacy

Onboarding reuses `settings_action` with fixed `started`, `completed`, and `skipped` workflow actions. Every event includes the canonical `module_id`: `catch-up`, `configuration`, `planning`, `board`, or `statistics`. The source is only `first_run` or `settings`; successful completion and skip are emitted only after persistence succeeds. Individual step views, target activation, and Next/Back navigation add no onboarding-specific event. The normal Priority, Project Track, and Status menus retain their existing safe options-open analytics. Privacy is unchanged: events never include step text or ids, Department/Team/sprint names, issue keys or summaries, URLs, search values, or user/workspace identity.
