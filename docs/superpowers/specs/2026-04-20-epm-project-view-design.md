# EPM Project View

**Date:** 2026-04-20
**Status:** Approved

## Problem

Jira Execution Planner is currently organized around engineering delivery by sprint, group, and team. That works for delivery leads, but it does not give Engineering Program Managers a project-centered view across multiple teams. EPMs need to pivot the dashboard around Jira Home projects and then pull the matching Jira work under each project.

## Goal

Add a first-class `EPM` view that keeps the existing `ENG` experience intact while introducing a project-centered workflow driven by Jira Home project discovery, Jira epic / label linkage, and optional augmentation in JEP settings.

## Terminology

- **ENG view**: the current Jira Execution Planner team-first dashboard.
- **EPM view**: the new project-first dashboard mode.
- **Jira Home project**: a project discovered from Atlassian Home / Goals & Projects.
- **JEP project configuration**: optional Jira linkage stored in Jira Execution Planner settings to improve or complete Jira Home metadata.
- **Resolved linkage**: the union of Jira Home linkage and JEP configuration linkage for one Home project.

## Design

### 1. Top-Level Navigation

The header gets a persistent, visible segmented switch in the top-right action area:

```text
ENG | EPM
```

- `ENG` preserves the current dashboard behavior exactly.
- `EPM` switches the aggregation model, filters, and data-loading path.
- The switch must remain visible in the main header and in the compact / sticky header state.
- The selected view is stored in existing UI preferences in local storage.

### 2. EPM Tabs And Controls

When `EPM` is selected, the dashboard uses three project-state tabs:

- `Active`
- `Backlog`
- `Archived`

Tab bucketing is based on Jira Home project state values:

- `Active`: `ON_TRACK`, `AT_RISK`, `OFF_TRACK`
- `Backlog`: `PENDING`, `PAUSED`
- `Archived`: `COMPLETED`, `CANCELLED`, `ARCHIVED`

Filter behavior by tab:

- `Active` uses `Sprint + Project`
- `Backlog` uses `Project` only
- `Archived` uses `Project` only

To keep the header layout stable, the sprint control remains rendered in all EPM tabs, but it is disabled outside `Active` with an `Active only` helper state.

### 3. Jira Home Project Catalog

The EPM project list is discovered from Atlassian Home using shared `.env` credentials in v1. Each project entry returned to the frontend should include:

- Jira Home project id
- project name
- project URL
- project status / state
- last update date
- latest update or comment snippet
- Jira linkage from Jira Home, if present
- Jira linkage from JEP config, if present
- merged linkage summary
- tab bucket
- match state

The EPM project picker is read-only in the main dashboard flow. Users do not create standalone local projects in JEP for v1.

### 4. JEP Project Configuration

JEP must expose an EPM configuration section inside the existing settings UI.

This section is an augmentation layer for Jira Home projects, not a separate catalog. It shows discovered Jira Home projects and lets the user optionally enrich each one with:

- Jira label
- Jira epic key

v1 supports one optional label and one optional epic key per Home project. The structure should leave room to grow into multiple values later.

If Jira Home already contains Jira linkage, the JEP settings do not replace it. They improve it.

### 5. Linkage Resolution Rules

For each Jira Home project, JEP resolves Jira scope using the union of all available linkage:

1. Jira Home label
2. Jira Home epic key
3. JEP-config label
4. JEP-config epic key

The project scope is the OR-union of these matches, de-duplicated.

There is no automatic slug-based fallback that derives `rnd_project_*` from the project name. If Jira Home has no Jira linkage, the fallback is explicit JEP configuration entered in settings.

If neither Jira Home nor JEP config provides Jira linkage, the project remains visible as metadata-only.

### 6. Jira Fetch Behavior

The EPM issues endpoint must fetch Jira work from the resolved linkage union:

- label linkage matches issues with the configured project label
- epic linkage matches the epic itself plus its child issues

The endpoint returns a de-duplicated issue list plus the epic / parent metadata needed to render grouped headers in the board.

Tab behavior:

- `Active`: apply sprint filtering to child work items, but keep parent initiative / epic headers visible for context
- `Backlog`: ignore sprint and fetch all matching Jira work for the selected project
- `Archived`: ignore sprint and fetch all matching Jira work for the selected project

### 7. Board Rendering

The EPM content area reuses the existing task-board presentation rather than introducing a new visual system.

In EPM mode:

- the board is project-first instead of team-first
- Jira work is grouped under parent initiative / epic headers when available
- `Active` shows sprint-scoped child work
- `Backlog` and `Archived` show all matched work without sprint filtering

Metadata-only projects render a descriptive empty state instead of an empty Jira board. That empty state includes:

- Jira Home project name
- Jira Home project link
- last update date
- latest update/comment snippet
- a clear CTA to connect Jira label / epic in settings

### 8. Backend API Shape

Add dedicated EPM endpoints instead of extending `/api/tasks`:

- `GET /api/epm/config`
- `POST /api/epm/config`
- `GET /api/epm/projects`
- `GET /api/epm/projects/<homeProjectId>/issues`

The ENG task endpoints stay untouched so the current sprint / group / team flow remains isolated.

### 9. Config Shape

Store EPM augmentation under a dedicated `epm` section in `dashboard-config.json`.

Example shape:

```json
{
  "epm": {
    "version": 1,
    "projects": {
      "tsq-project-123": {
        "homeProjectId": "tsq-project-123",
        "jiraLabel": "rnd_project_payments_rework",
        "jiraEpicKey": "PAY-4821"
      }
    }
  }
}
```

This must coexist with existing `projects`, `teamGroups`, `board`, `capacity`, and field configuration sections without overwriting them.

### 10. Home API Integration Constraints

The Home integration must reuse the lessons from the existing Jira Home project:

- do not assume GraphQL field names from public docs
- introspect the live schema before depending on project linkage fields
- degrade gracefully when Jira metadata fields are absent
- keep project state, URL, latest update date, and latest update snippet available even when Jira linkage is missing

The initial implementation should validate the live schema for:

- project state
- project URL
- project updates
- any Jira label / Jira epic metadata fields needed for linkage

### 11. Performance And Caching

EPM data must not increase `ENG` startup cost.

Performance rules:

- no EPM preload during default page load
- fetch Jira Home projects only after the user switches to `EPM`
- fetch Jira issues only for the selected EPM project
- keep EPM caches separate from `TASKS_CACHE`
- add `Server-Timing` for EPM endpoints

Recommended cache layers:

- EPM project catalog cache keyed by Home credentials + config signature
- EPM issues cache keyed by project id + tab + sprint id + linkage signature

### 12. Testing

Backend coverage:

- EPM config normalization and persistence
- Jira Home project normalization and tab bucketing
- latest update extraction
- linkage merge between Jira Home and JEP config
- OR-union Jira scope building
- de-duplication
- sprint filtering only for `Active`

Frontend coverage:

- header `ENG | EPM` switch rendering
- EPM tab rendering: `Active`, `Backlog`, `Archived`
- sprint disabled outside `Active`
- settings UI EPM configuration section
- project selection persistence
- metadata-only rendering path

Manual verification:

- `ENG` request count unchanged on first load
- header and compact sticky header render the view switch correctly
- `Active`, `Backlog`, and `Archived` each show the expected filtering behavior

## Non-Goals For V1

- per-user credential storage outside `.env`
- manual creation of EPM projects that do not exist in Jira Home
- multi-label / multi-epic editing UI
- changing Jira Home metadata directly from JEP
