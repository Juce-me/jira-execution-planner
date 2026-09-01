# User Onboarding

In authenticated workspace-database mode, first run has four phases:

1. Choose an eligible existing Department, or choose **Add Department** to create, duplicate, or repair one.
2. Configure the draft in the real Settings → Departments → Team Groups editor.
3. Complete a verified **Save and continue**.
4. Start the dashboard tour only when onboarding is still incomplete and the dashboard is on a desktop-sized viewport.

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

## Phase 4: dashboard tour

After Department setup succeeds, an incomplete user can start the guided ENG Catch Up tour. It covers dashboard controls, hierarchy, Jira handoff, and read-only Priority, Project Track, and Status menu previews. Opening a highlighted field control advances the preview without choosing a value or mutating Jira. Missing or unavailable targets use explanatory fallback steps with manual navigation.

The dashboard tour is desktop only. At viewport widths of 760px or less it stays closed, while the first-run Department chooser and configuration continue to work. Mobile dashboard-tour work is deferred in GitHub issue #151.

The tour is skippable with **Skip onboarding** or Escape. **Finish** and Skip persist completion before closing. A failed write keeps the tour open with a retryable error; an expired session uses the app-wide sign-in recovery. The tour never changes the active sprint, Department scope, Teams, favorite, Priority, Project Track, or Jira Status.

Tour progress is session-only. Reloading an unfinished tour restarts at its first eligible step. A successful Finish or Skip prevents later automatic replay.

## Replay from Settings

In Atlassian OAuth workspace-database mode, **Run onboarding again** remains at the right of the Settings header across tabs. It is disabled while any Settings section is dirty or saving. Starting replay first persists incomplete onboarding, closes Settings, prepares ENG Catch Up, and opens the desktop tour. A failed write keeps Settings open and leaves the previous state unchanged.

Replay does not alter Department visibility, the saved favorite, dashboard scope, sprint, or Team selection. Users who have already completed onboarding are not replayed automatically.

## Analytics and privacy

Onboarding reuses `settings_action` with fixed `started`, `completed`, and `skipped` workflow actions. The source is only `first_run` or `settings`; successful completion and skip are emitted only after persistence succeeds. Individual step views, target activation, and Next/Back navigation add no onboarding-specific event. The normal Priority, Project Track, and Status menus retain their existing safe options-open analytics. Events never include step text or ids, Department/Team/sprint names, issue keys or summaries, URLs, search values, or user/workspace identity.
