# Split teamCatalog Out of Groups Config

**Date:** 2026-03-06
**Branch:** `investigate/default-group-team-catalog`
**Status:** Approved

## Problem

`teamCatalog` (a cache of teamId-to-name mappings) and `teamCatalogMeta` are stored inside the groups configuration object. The backend never reads them — it only passes them through. This mixes transient cache data with user configuration, bloating config saves/exports and creating conceptual confusion.

## Decision

Separate `teamCatalog` and `teamCatalogMeta` into their own file (`team-catalog.json`) with dedicated API endpoints. Groups config becomes purely configuration.

## Approach: Separate File + Dedicated API (Approach A)

### New File: `team-catalog.json`

```json
{
  "catalog": {
    "teamId1": { "id": "teamId1", "name": "Team Alpha" }
  },
  "meta": {
    "updatedAt": "2026-03-05T...",
    "sprintId": "123",
    "sprintName": "Q1 Sprint 3",
    "source": "sprint",
    "resolvedAt": "2026-03-05T..."
  }
}
```

Path: `TEAM_CATALOG_PATH` env var, default `./team-catalog.json`.

### Backend Changes (`jira_server.py`)

**New functions:**
- `resolve_team_catalog_path()` — returns env var or default
- `load_team_catalog()` — reads file, returns `{catalog: {}, meta: {}}` if missing
- `save_team_catalog(data)` — normalizes and writes
- `migrate_team_catalog_from_config()` — one-time extraction from `dashboard-config.json`

**New endpoints:**
- `GET /api/team-catalog` — returns `{catalog, meta}`
- `POST /api/team-catalog` — validates, saves, returns `{catalog, meta}`

**Modified functions:**
- `validate_groups_config()` — remove `teamCatalog`/`teamCatalogMeta` from normalized output
- `build_default_groups_config()` — remove `teamCatalog: {}`/`teamCatalogMeta: {}`
- `get_groups_config()` / `save_groups_config()` — no longer pass through catalog fields

### Frontend Changes (`dashboard.jsx`)

**State:**
- New `teamCatalog` state: `{catalog: {}, meta: {}}`
- Remove `teamCatalog`/`teamCatalogMeta` from `groupsConfig` initial state

**Load:**
- New `loadTeamCatalog()` fetches `GET /api/team-catalog`
- `loadGroupsConfig()` no longer expects catalog in response

**Save:**
- `fetchTeamsFromJira` and `resolveTeamNames` → `POST /api/team-catalog`
- `saveGroupDraft()` payload excludes catalog fields

**Reads:**
- All `groupDraft.teamCatalog` / `groupsConfig.teamCatalog` references → `teamCatalog.catalog`
- All `teamCatalogMeta` references → `teamCatalog.meta`

**Dirty detection:**
- `hasGroupChanges` no longer includes catalog in comparison

**Export/Import:**
- Export excludes catalog
- Import: if JSON contains `teamCatalog`, extract and save via `POST /api/team-catalog`

### Migration

On first `GET /api/team-catalog`:
1. If `dashboard-config.json → teamGroups.teamCatalog` has entries and `team-catalog.json` doesn't exist
2. Extract to `team-catalog.json`, remove from `teamGroups`, re-save `dashboard-config.json`
3. Idempotent — safe to run multiple times

### What Doesn't Change

- `normalize_team_catalog()` / `normalize_team_catalog_meta()` reused by new endpoints
- `/api/teams` and `/api/teams/resolve` unchanged
- Group validation of `defaultGroupId`, groups, etc. unchanged

### Tests

- Backend: test new endpoints, migration, validate_groups_config no longer includes catalog
- Frontend: verify separate load/save, dirty detection excludes catalog
