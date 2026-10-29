# EPM View

Use the header `ENG | EPM` switch to move between team delivery and project delivery.

The Jira rollup toggle uses the shared button overlay and blue ring. Collapse all
and the settings gear use tinted circles; project, update and duplicate-issue links
underline. Passive project status and label chips keep their resting appearance.
Hover feedback is limited to enabled controls on hover-capable devices. Desktop
and narrow progress readouts retain their placement, reveal and focus behavior;
the [design-system map](../design-system.md) records the shared control owners.

In DB/OAuth mode, EPM is intentionally hidden until the signed-in user connects a Home/Townsquare token in `Settings -> Connections`. Jira REST reads use the user's Atlassian OAuth session. Home/Townsquare metadata reads use the same user's connected `atlassian_user_api_token`, stored encrypted in DB `auth_tokens`. Shared service credentials are not a DB/OAuth EPM fallback.

The Home token is a credential connection, not EPM saved-view state. Token material is not stored in dashboard config, EPM config, JSON files, browser local storage, API responses, or user view payloads.

- `Active` uses both the selected project and the selected sprint, and includes pending, on-track, at-risk, and off-track Home projects.
- `Backlog` ignores sprint and shows paused project work.
- `Archived` ignores sprint and shows completed, cancelled, or archived project work.

If `Active` has no sprint selected, the dashboard keeps the EPM project selected but does not request Jira issues until you choose a sprint.

The EPM Epic assignee and the project owner circle show a profile photo in their existing slot when one is available (`ui/PersonAvatar.jsx`); otherwise the glyph or the initials stay. The Epic assignee photo comes from the optional `assigneeAvatarUrl` on the existing slim issue payload, taken from the 32x32 Jira avatar and kept only when it is on an Atlassian-hosted avatar host (`backend/security/avatar_urls.py`). Gravatar-hosted and generated-initials avatars are never loaded. The owner circle shows a photo only when the Home owner data already carries an allowlisted URL; the OAuth `public-read-v1` Home queries omit the owner, so OAuth-mode owners stay on initials. There is no new request.

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

The #251 automatic-return implementation reads Home metadata before one selected or aggregate Jira rollup, then accepts both together. Loaded projects and expanded work remain visible during acquisition and failure. A successful metadata removal clears that project's canonical Jira content and prevents a rollup read for it; the selected Project ID remains held. Once current-scope metadata is accepted, a missing selected Project shows "Project unavailable", including after a successful empty list. Loading or failed initial metadata does not establish absence and preserves the saved selection; until metadata is accepted, an unresolved selection displays "All projects". Metadata cache observations and unknown rollup coverage remain distinct. See [return behavior and remaining verification gates](eng-workflows.md#return-after-an-absence).
