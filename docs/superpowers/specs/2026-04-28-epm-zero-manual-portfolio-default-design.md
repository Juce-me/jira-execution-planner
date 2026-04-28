# EPM Zero-Manual Portfolio Default

**Date:** 2026-04-28
**Status:** Draft for review

## Problem

The current EPM flow still asks the user to do too much configuration before the view becomes useful:

- EPM Project rows depend on manually selected Jira labels, even though each Atlassian Home project already has tags that mirror the Jira project labels.
- The EPM view starts in single-Project drill-down mode, so the user must pick a Project before seeing work.
- The Active tab depends on sprint state, but the EPM controls do not make the sprint selector visible in the same view.

The product principle for this work is: the user should do almost nothing. EPM defaults must be inferred from Atlassian Home and immediately render the portfolio view.

## Goals

1. Auto-fill EPM Project rows from Atlassian Home.
   - Project name is the Atlassian Home project display name.
   - Jira label is the single Home project tag whose name starts with the configured `epm.labelPrefix`, matched case-insensitively.
   - Manual Jira label search stays available only as a fallback or explicit override.

2. Default the EPM view to all visible Projects.
   - Landing on EPM shows every Project visible under the active lifecycle tab.
   - The user does not need to pick a Project from a dropdown before seeing Initiative/Epic/Story rollups.
   - Single-Project focus remains available as a narrowing mode.

3. Make Active sprint scope visible and functional in EPM.
   - EPM Active renders a sprint selector in the EPM control area, reusing the existing sprint state/control where possible.
   - Selecting a sprint loads the issue hierarchy for every visible Project at once.
   - A labeled Project with a selected sprint must not render as a metadata-only stub.

## Non-Goals

- No label inference from project names, slugs, or fuzzy matching.
- No wildcard label matching in Jira rollups. The selected Home tag name becomes the exact Jira label.
- No new persistent search-first settings UX. Settings remains compact, with search exposed only when manually changing a value.
- No change to the meaning of `epm.labelPrefix`: it filters Home project tags and manual Jira label search; it is not included in Jira rollup JQL as a wildcard.
- No real Jira, Home, or identifiable customer data in tests.

## Current State

`epm_home.py` loads Atlassian Home goals and projects through the existing Townsquare GraphQL endpoint and shapes each project with metadata, state, and latest update. It currently has no project tag linkage: `extract_home_jira_linkage()` returns empty labels and epics, so `build_epm_project_payload()` falls back to saved config rows for Jira labels.

`frontend/src/dashboard.jsx` already has EPM settings rows and manual Jira label autocomplete backed by `/api/jira/labels`. That path should remain as an override, not the primary source of Project labels.

`docs/superpowers/specs/2026-04-27-epm-multi-project-rollup-design.md` already designs the all-Projects portfolio rollup endpoint and render branch. This design adopts that default behavior as part of the product goal instead of treating it as optional future work.

`postmortem/MRT012-epm-active-sprint-value-hidden.md` documents the Active sprint visibility bug. This design treats sprint visibility as a prerequisite for a correct EPM Active portfolio view.

## Atlassian Home Tag Source

Each Atlassian Home project has its own tags. The screenshot-confirmed source is the individual project page sidebar, not the sub-goal updates feed.

Implementation must use this source order:

1. Probe the existing Home/Townsquare `projects_byId` GraphQL shape for project tags. If tags are available on that endpoint, fetch them with the existing project detail request so Home project discovery stays in one cached path.
2. If the existing endpoint does not expose tags, use the documented Teamwork Graph relationship:

   ```cypher
   MATCH (project:AtlassianProject {ari: $id})
     -[:atlassian_project_has_atlassian_home_tag]->(tag:AtlassianHomeTag)
   RETURN tag
   ```

   The project ARI is derived from the Home project id or project URL plus site cloud id. If direct ARI construction does not match the live Teamwork Graph shape, use Teamwork Graph's URL-to-ARI resolution before running the relationship query. The tag `name` is the candidate Jira label.

If both sources fail for a project, the row remains visible but is marked as requiring manual label selection. That is a fallback state, not the happy path.

## Label Selection Rules

For each Home project:

1. Normalize `epm.labelPrefix` by trimming whitespace. Match tags case-insensitively with `tag.name.lower().startswith(prefix.lower())`.
2. If exactly one tag matches, use that tag's original display name as the Jira label.
3. If zero tags match, leave the project metadata-only and show a compact "No matching Home tag" state in settings.
4. If more than one tag matches, do not guess. Mark the project as ambiguous and require manual override.
5. If the saved config row already has a non-empty `label`, the saved manual label wins over the Home tag.

The response should preserve enough metadata for the UI to explain the source:

```json
{
  "label": "rnd_project_bsw_enablement",
  "labelSource": "home-tag",
  "homeTags": ["epm", "data", "rnd_project_bsw_enablement"],
  "homeTagMatches": ["rnd_project_bsw_enablement"],
  "labelStatus": "auto"
}
```

Required `labelStatus` values:

- `auto`: exactly one Home tag matched and no manual override exists.
- `manual`: saved config label overrides Home tags.
- `missing`: no matching Home tag and no manual label.
- `ambiguous`: multiple matching Home tags and no manual label.
- `unavailable`: tag fetch failed or the tag API is inaccessible and no manual label exists.

Only `label` is required for rollups. The source/status fields are for settings clarity and tests.

## Backend Design

Extend `epm_home.py`:

- Add tag extraction helpers that normalize tag nodes from either Home GraphQL or Teamwork Graph.
- Add a `homeTags` array to each Home project record, storing raw tag names after de-duplication.
- Keep raw Home tags in the existing Home projects cache. Prefix filtering happens when shaping EPM Project payloads, so changing `epm.labelPrefix` does not require refetching Home projects.
- Keep bounded fan-out. If Teamwork Graph requires one call per project, perform tag fetches inside the existing `ThreadPoolExecutor(max_workers=8)` project enrichment path.

Extend EPM project shaping in `jira_server.py`:

- Use the Home project name as `name` / `displayName` unless a saved manual custom name exists.
- Resolve label source with the rules above.
- Set `resolvedLinkage.labels` from the resolved label.
- Set `matchState` to `home-linked` when the label came from Home tags, `jep-fallback` when it came from saved manual config, and `metadata-only` only when no label is available.
- Do not clear saved labels or custom names on project reload.

Rollup behavior:

- A Project with `labelStatus: auto` or `manual` is considered labeled and must be eligible for per-Project and aggregate rollups.
- Metadata-only rendering is valid only for `missing`, `ambiguous`, or unavailable tag fetch states without a manual label.

## Frontend Design

Settings:

- Project rows arrive pre-filled from `/api/epm/projects/configuration`.
- Display the Home project name as the default Project name.
- Display the auto-filled Jira label as a selected compact chip/control.
- Keep "Search Jira labels..." hidden until the user explicitly changes the label.
- For `missing` or `ambiguous`, show the compact selected-state control with a manual action to choose a Jira label.

EPM view:

- The Project picker default option becomes `All projects`.
- Empty project selection means all visible Projects for the current EPM tab.
- Focus mode remains available by selecting a specific Project.
- On Active, render the existing sprint selector in the EPM control area and compact sticky header.
- When Active has no sprint selected, show the sprint-required empty state and do not fetch rollups.
- When Active has a sprint selected, fetch the all-Projects rollup for every visible labeled Project.

This adopts the existing multi-project rollup design for the board shape: one stacked board per Project, duplicate warnings at the top, metadata-only cards only for truly unlabeled Projects, and Initiative/Epic/Story trees for labeled Projects.

## API Design

The existing endpoints keep their roles:

- `GET /api/epm/projects` returns saved EPM Projects shaped with Home tag labels.
- `POST /api/epm/projects/configuration` returns draft EPM Projects shaped with Home tag labels.
- `GET /api/epm/projects/<id>/rollup` remains the focus-mode endpoint.
- `GET /api/epm/projects/rollup/all` becomes the default EPM view endpoint for all-Projects mode.

The all-Projects endpoint contract follows `2026-04-27-epm-multi-project-rollup-design.md`:

- `tab` is required.
- `sprint` is required when `tab=active`.
- Visible Projects are filtered by lifecycle tab.
- Projects without labels are included as metadata-only entries.
- Labeled Projects produce rollup trees.

## Caching and Performance

- Home project discovery cache stores raw Home project metadata and raw Home tag names.
- EPM Project response shaping applies `labelPrefix` after reading the cache.
- Aggregate rollup cache includes the visible label tuple, tab, sprint, base JQL, and issue-type signature.
- Initial dashboard load must not gain extra EPM fetches. Tag enrichment happens only when EPM Home projects are already being fetched.
- Settings open must not trigger the production EPM view fetch path. Preview/test configuration remains explicit.

## Error Handling

- Home tag fetch failures are logged per project and returned as a non-fatal label status.
- A Home project remains visible even if its tags cannot be fetched.
- A tag-fetch failure should not block other Projects in the same sub-goal.
- Ambiguous matching tags require manual selection. The system does not pick the first tag.
- Manual override remains the escape hatch for API gaps or data cleanup.

## Testing

Backend tests:

- Tag extraction normalizes tag nodes from Home GraphQL and Teamwork Graph response shapes.
- Prefix matching is case-insensitive and preserves the original tag name.
- Exactly one matching Home tag auto-fills `label`, `resolvedLinkage.labels`, `labelSource`, and `labelStatus`.
- Saved manual label overrides Home tag.
- Multiple matching tags produce `labelStatus: ambiguous` and no auto label.
- Zero matching tags produce `labelStatus: missing`.
- `GET /api/epm/projects` and `POST /api/epm/projects/configuration` use cached Home project records but reshape labels when `labelPrefix` changes.

Frontend/source tests:

- Settings rows render auto-filled labels as selected controls without showing persistent Jira search.
- Manual label search remains available as an override.
- EPM default picker option is `All projects`, not `Select project...`.
- No project selected triggers the aggregate rollup fetch, not the focus endpoint.
- EPM Active renders the sprint control in both main and compact controls.
- Active without sprint does not fetch rollups.
- Active with sprint fetches aggregate rollup using the selected sprint.
- Metadata-only UI is not rendered for labeled Projects.

Manual verification:

- Open Settings -> EPM after configuring root/sub-goal and prefix. Confirm Home project names and labels auto-fill with no manual search.
- Switch to EPM Active, choose a sprint, and confirm all visible Projects load rollups simultaneously.
- Switch to Backlog and Archived and confirm all visible Projects load without a sprint.
- Select one Project and confirm focus mode still works.
- Confirm a Project with no matching tag shows the fallback manual label action.

## Rollout Order

1. Implement Home project tag discovery and auto-fill shaping.
2. Implement or finish all-Projects default rollup.
3. Implement visible EPM Active sprint control.
4. Verify the full zero-manual flow end to end.

This order prevents the portfolio view from launching with metadata-only stubs for Projects that Atlassian Home can already label.

## References

- Atlassian tags are metadata attached to goals and projects: https://support.atlassian.com/platform-experiences/docs/what-are-tags-and-topics/
- Teamwork Graph project-to-tag relationship: https://developer.atlassian.com/platform/teamwork-graph/api-reference/relationship-types/atlassian-project-has-atlassian-home-tag/
- Teamwork Graph Home tag object: https://developer.atlassian.com/platform/teamwork-graph/api-reference/object-types/AtlassianHomeTag/
- ARI and cloud id guidance: https://developer.atlassian.com/platform/teamwork-graph/understanding-aris/
