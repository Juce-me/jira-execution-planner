# EPM View

Use the header `ENG | EPM` switch to move between team delivery and project delivery.

In DB/OAuth mode, EPM is intentionally hidden until the signed-in user connects a Home/Townsquare token in `Settings -> Connections`. Jira REST reads use the user's Atlassian OAuth session. Home/Townsquare metadata reads use the same user's connected `atlassian_user_api_token`, stored encrypted in DB `auth_tokens`. Shared service credentials are not a DB/OAuth EPM fallback.

The Home token is a credential connection, not EPM saved-view state. Token material is not stored in dashboard config, EPM config, JSON files, browser local storage, API responses, or user view payloads.

- `Active` uses both the selected project and the selected sprint, and includes pending, on-track, at-risk, and off-track Home projects.
- `Backlog` ignores sprint and shows paused project work.
- `Archived` ignores sprint and shows completed, cancelled, or archived project work.

If `Active` has no sprint selected, the dashboard keeps the EPM project selected but does not request Jira issues until you choose a sprint.

The EPM settings panel auto-detects the Atlassian site from Jira, then lets operators choose a root goal and one or more of its child sub-goals. EPM project discovery includes projects linked directly to the selected sub-goals and projects linked to their nested child goals.

EPM Jira queries stay scoped to the Jira projects in `dashboard-config.json -> projects.selected`. If an Atlassian Home project maps to Jira work outside that set, add the Jira project in Settings first.

The EPM config v2 shape stores `epm.labelPrefix`, plus one Project row per rollup with `name`, exact Jira `label`, and optional `homeProjectId`. `labelPrefix` only filters label autocomplete in `Settings -> EPM`; rollup queries use the saved full label exactly, with no wildcard or fallback.

Project rollups use three Jira queries:

1. Q1 finds issues that carry the Project label directly.
2. Q2 finds children of labeled Initiatives or Epics.
3. Q3 finds grandchildren under Epics discovered from Q2.

The rollup response renders a three-level hierarchy: Initiative -> Epic -> Story/Task. Labeled Epics without a labeled Initiative render as root Epics, and directly labeled Stories without a labeled parent render as orphan Stories. On the `Active` tab, the selected sprint is applied inside each Q1/Q2/Q3 JQL query; `Backlog` and `Archived` ignore sprint.

`metadataOnly` and `emptyRollup` are separate states. `metadataOnly` means the Project has no saved label, so the dashboard shows the Atlassian Home card plus `Open Settings` instead of querying Jira. `emptyRollup` means a label is saved but no Jira issues match it in the current scope.

Custom Projects are created in `Settings -> EPM` with only a name and exact Jira label. They are not backed by Atlassian Home metadata, and the server assigns their UUID on first save.
