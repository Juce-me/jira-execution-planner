# EPM View

Use the header `ENG | EPM` switch to move between team delivery and project delivery.

- `Active` uses both the selected project and the selected sprint.
- `Backlog` ignores sprint and shows pending or paused project work.
- `Archived` ignores sprint and shows completed, cancelled, or archived project work.

If `Active` has no sprint selected, the dashboard keeps the EPM project selected but does not request Jira issues until you choose a sprint.

The EPM settings panel auto-detects the Atlassian site from Jira, then lets operators choose a root goal and one of its child sub-goals. The selected child sub-goal is the exact Jira Home catalog used for EPM projects.

EPM Jira queries stay scoped to the Jira projects in `dashboard-config.json -> projects.selected`. If an Atlassian Home project maps to Jira work outside that set, add the Jira project in Settings first.

If a project lands in the metadata-only state, the dashboard shows the Atlassian Home card and an `Open Settings` call to action instead of an empty Jira board. Add a Jira label or Jira epic key in `Settings -> EPM` to pull Jira work into the view.
