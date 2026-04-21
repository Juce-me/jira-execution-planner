# EPM Goal Picker Design

Date: 2026-04-21
Status: Proposed
Owner: Codex

## Summary

Replace the current manual EPM scope entry with a guided Atlassian Home selector:

- auto-detect the Atlassian site `cloudId` from Jira
- let operators choose a `rootGoalKey`
- let operators choose a `subGoalKey` from that root goal's child goals

This design also fixes the current Home fetch bug and aligns this repo's Home integration with the proven patterns in `/Users/a.feygin/Documents/claude-jira-home-api`.

## Problem

The current EPM scope flow is wrong in two ways:

1. The backend builds the Home container ID as `ati:cloud:townsquare::site/...` instead of `ari:cloud:townsquare::site/...`, so valid scope values fail before goal resolution.
2. The settings UI asks operators to paste a `subGoalKey` manually, but a valid goal can still produce an empty catalog if it is a parent goal with no direct projects.

Live verification on 2026-04-21:

- `https://<jira-site>.atlassian.net/_edge/tenant_info` returned `cloudId = c7a75b15-6b77-49a8-a9e0-96287bc6e3c0`
- Atlassian Home goal `CRITE-223` exists
- `CRITE-223` has `0` direct linked projects
- child goals under `CRITE-223` do have direct projects, for example `CRITE-93 [EPM] Retail Media`

That means the current text-field UX is structurally wrong for this hierarchy even after the ARI bug is fixed.

## Goals

- Remove manual `cloudId` entry from `Settings -> EPM`
- Auto-detect the Jira site's Atlassian Home `cloudId`
- Replace raw `subGoalKey` entry with guided selection
- Make the operator choose a root goal first, then a child sub-goal
- Keep the existing EPM project fetch scoped to the selected child sub-goal
- Surface clear empty-state messaging when a valid goal has no direct projects

## Non-Goals

- Do not support arbitrary cross-site Home browsing in this change
- Do not add root-goal project traversal to EPM project fetch
- Do not change the existing Jira linkage model beyond keeping `customName`, `jiraLabel`, and `jiraEpicKey`
- Do not broaden EPM Jira issue queries outside `dashboard-config.json -> projects.selected`

## Existing Research To Reuse

This repo should copy the Home API patterns already proven in `/Users/a.feygin/Documents/claude-jira-home-api`:

- container ID format: `ari:cloud:townsquare::site/{cloud_id}`
- goal resolution: paginate `goals_search` and match goal key client-side
- do not rely on `goals_byKey`

This matters because live checks show Home `goals_search(searchString: ...)` is not trustworthy enough for exact key lookup in this tenant. The safe pattern is still full paginated fetch plus local key match.

## Configuration Model

Persist EPM scope as:

```json
{
  "version": 1,
  "scope": {
    "rootGoalKey": "CRITE-223",
    "subGoalKey": "CRITE-93"
  },
  "projects": {
    "...": {
      "homeProjectId": "...",
      "customName": "...",
      "jiraLabel": "...",
      "jiraEpicKey": "..."
    }
  }
}
```

Notes:

- `cloudId` is no longer persisted in EPM config
- `rootGoalKey` is persisted because the chosen child list depends on it
- `subGoalKey` remains the actual fetch scope for `/api/epm/projects`
- existing saved configs with `scope.cloudId` must still read safely during transition, but new writes should stop persisting it

## Backend Design

### 1. Fix Home container ID

Change `_container_id_from_cloud()` in [epm_home.py](/Users/a.feygin/Documents/jira-execution-planner/epm_home.py) to return:

```python
f"ari:cloud:townsquare::site/{cloud_id}"
```

### 2. Detect site cloud ID from Jira

Add a small backend helper that requests:

```text
{JIRA_URL}/_edge/tenant_info
```

and returns:

```json
{ "cloudId": "..." }
```

Rules:

- Use the configured Jira base URL from `.env`
- This is the single source of truth for the site's Home `cloudId`
- If detection fails, return a structured error the settings UI can render and disable goal pickers

### 3. Add goal discovery helpers

Add Home helpers that:

- fetch the full paginated site goal catalog for the detected `cloudId`
- resolve a goal by key via local key match
- fetch non-archived child goals for a selected root goal

Returned goal rows should include:

- `id`
- `key`
- `name`
- `url`

### 4. Add settings-facing scope endpoints

Introduce two narrow endpoints:

1. `GET /api/epm/scope`
   returns:
   - detected `cloudId`
   - whether detection succeeded
   - current saved `rootGoalKey`
   - current saved `subGoalKey`

2. `GET /api/epm/goals?rootGoalKey=<key optional>`
   behavior:
   - without `rootGoalKey`: return the site goal catalog for the root-goal picker
   - with `rootGoalKey`: resolve the root goal, then return its non-archived child goals for the sub-goal picker

This design keeps settings discovery separate from `/api/epm/projects`, which should continue returning only project catalog data.

### 5. Keep project fetch scoped to child sub-goal

`fetch_epm_home_projects()` should change from:

- requiring `cloudId` + `subGoalKey`

to:

- resolving `cloudId` internally from Jira
- requiring `subGoalKey`
- resolving the selected sub-goal by key from the full site goal catalog
- fetching direct projects for that child goal only

This preserves the current EPM behavior: the selected child goal owns the project catalog.

## Frontend Design

### Settings -> EPM scope card

Replace the current scope inputs with:

1. `Atlassian site`
   - read-only detected `cloudId`
   - helper text when detection fails

2. `Root goal`
   - searchable picker
   - rows show `KEY · Name`

3. `Sub-goal`
   - disabled until a root goal is selected
   - searchable picker populated from the selected root goal's children
   - rows show `KEY · Name`

Behavior:

- loading the settings modal fetches current saved scope plus detected site data
- selecting a new root goal clears any draft sub-goal selection immediately
- selecting a sub-goal updates `epmConfigDraft.scope.subGoalKey`
- saving persists `rootGoalKey` and `subGoalKey`

### Project catalog feedback

If the chosen child sub-goal resolves successfully but returns zero direct projects, show an explicit helper:

`This sub-goal has no direct Jira Home projects. Choose a different child goal.`

Do not collapse this state into the generic empty catalog message.

## Data Flow

1. Settings modal opens
2. Frontend requests saved EPM config
3. Frontend requests `/api/epm/scope`
4. Frontend requests `/api/epm/goals` for root-goal options
5. If a saved `rootGoalKey` exists, frontend requests `/api/epm/goals?rootGoalKey=<saved-root>`
6. User picks a root goal, then a child sub-goal
7. Save persists `rootGoalKey` and `subGoalKey`
8. `refreshEpmProjects()` uses saved scope and fetches project catalog for the selected child sub-goal

## Error Handling

- If `tenant_info` fails, show a settings error and disable root/sub-goal pickers
- If the saved `rootGoalKey` no longer exists, keep config editable but require reselection
- If the saved `subGoalKey` is not present under the selected root goal, clear the draft sub-goal and show helper copy
- If Home authentication fails, keep the existing EPM error surface
- If the selected child goal has no direct projects, show the explicit empty-catalog helper

## Testing

Write failing tests first for:

### Backend

- container ID uses `ari:`
- site cloud ID detection via Jira `/_edge/tenant_info`
- paginated goal resolution matches keys client-side
- child-goal listing for a selected root goal
- `fetch_epm_home_projects()` no longer depends on persisted `cloudId`
- config normalization for `rootGoalKey` and `subGoalKey`

### Frontend/source guards

- settings source guard expects read-only site display instead of editable `cloudId`
- root-goal picker wiring exists
- sub-goal picker wiring exists
- selecting a root goal clears draft sub-goal
- saved-scope gating still works with the new scope shape

### Regression

- existing EPM projects endpoint tests
- existing EPM scope resolution tests
- existing EPM issues endpoint tests
- build guard tests for settings and shell

## Manual Verification

- `Settings -> EPM` shows detected site cloud ID automatically
- root-goal picker loads site goals
- choosing `CRITE-223` loads child goals such as `CRITE-93`
- choosing `CRITE-93` populates EPM projects
- `Custom name` still changes the EPM picker label
- Jira label selection still works
- metadata-only project rendering still works
- `Active` still requires sprint
- `Backlog` and `Archived` still ignore sprint
- ENG-only panels stay hidden in EPM

## Recommended Implementation Order

1. Fix Home container ID and add site cloud-ID detection
2. Add goal catalog and child-goal backend helpers/endpoints
3. Migrate EPM config scope from `cloudId/subGoalKey` to `rootGoalKey/subGoalKey`
4. Replace settings scope inputs with root/sub-goal pickers
5. Re-run existing EPM verification gates and browser smoke

## Risks

- Home goal catalogs are paginated and moderately large; cache discovery responses separately from project fetches
- Root-goal changes can invalidate the saved sub-goal; the UI must clear this explicitly
- If multiple goals share similar names, the picker must always show goal keys

## Decision

Proceed with a root-goal to child-sub-goal picker flow, auto-detected site `cloudId`, and a corrected Home GraphQL container ARI. This is the smallest design that matches the live Home hierarchy and removes the current broken manual scope entry.
