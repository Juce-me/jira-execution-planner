# User Onboarding

User onboarding has two distinct stages in authenticated workspace-database mode: a mandatory personal Department choice and a skippable dashboard tour. The choice establishes the user's saved favorite and must finish successfully before group-scoped dashboard data or the tour can load.

## Mandatory Department selection

First-time users must select exactly one eligible Department group. This stage has no Skip action. It reuses the personal-group favorite contract described in [Personal Group Favorite](personal-group-star.md): the filled star is a per-user preference, never the workspace's shared `defaultGroupId`, and the onboarding tour does not change it.

Users who need a different setup can choose **Configure your own**. Settings opens directly to Departments → Team groups. When groups already exist, the guidance recommends duplicating one and adjusting its teams; when none exist, the existing Add group flow remains available. Saving or cancelling returns to the mandatory selector, and creating or duplicating a group does not star it automatically. A validation or save failure stays in Settings so the user can correct and retry it.

JSON, file, and environment configuration modes keep their existing shared-default behavior. These modes and Basic-auth mode do not automatically run or replay the tour and do not write onboarding state, even when a workspace database configuration exists alongside them. The personal selection and tour flow is available only with Atlassian OAuth and workspace-database group configuration.

## Dashboard tour

After the required Department preference is saved, a new user starts a guided tour in ENG Catch Up. The tour explains the visible Sprint, Department, Teams, Search, Jira export, Refresh, filter, issue hierarchy, and editable issue controls. Optional or unavailable controls are omitted, and explanatory fallback cards keep the tour finishable when issue data is absent or still loading.

The tour is skippable with **Skip onboarding** or Escape. **Finish** and Skip persist completion before closing. If that write fails, the tour remains open with a retryable error. If authentication expires, the app-wide authentication gate replaces the dashboard and provides the sign-in recovery action. The tour never changes the active sprint, current Department scope, selected teams, or personal favorite.

Tour progress is session-only. If a user reloads or otherwise interrupts an unfinished tour, no individual step is saved and the next load restarts at the first eligible step. A successful Finish or Skip prevents automatic replay on later loads.

## Replay from Settings

In Atlassian OAuth workspace-database mode, **Run onboarding again** is available in Settings. It is disabled while any Settings section is dirty or saving. Starting a replay first persists the incomplete state, closes Settings, prepares ENG Catch Up, and opens the tour. A failed write keeps Settings open and leaves the previous state unchanged.

Replay does not alter Department visibility, the saved favorite, current dashboard scope, sprint, or team selection.

## Analytics and privacy

Onboarding reuses `settings_action` with fixed `started`, `completed`, and `skipped` workflow actions. The source is only `first_run` or `settings`; successful completion and skip are emitted only after persistence succeeds. Individual step views and Next/Back navigation are intentionally untracked. Events never include step text or ids, group/team/sprint names, issue keys or summaries, URLs, search values, or user/workspace identity.
